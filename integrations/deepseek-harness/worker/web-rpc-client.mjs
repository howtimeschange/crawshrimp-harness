/**
 * Controlled client for the public DSH Web profile transport.
 *
 * The browser launch capability is exchanged inside this local worker and is
 * never returned over stdio. The trusted Electron iframe receives the same
 * loopback-only capability through the product API and establishes its own
 * browser cookie. All Worker calls use the Host's cookie-protected RPC and
 * WebSocket interfaces.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import WebSocket from 'ws'

const PROFILE_FILES = ['cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml']
const PRODUCT_PRESET_FILES = [
  'agent-presets/crawshrimp-standard/agent.cordis.yml',
  'agent-presets/crawshrimp-standard/preset.yml',
]
const PRODUCT_PROFILE_PACKAGES = ['@xmanrui/dsh-im', 'crawshrimp-product-bridge', 'crawshrimp-slots']
export const NATIVE_WEB_TOOL_NAMES = Object.freeze(['web_search', 'web_fetch'])

export class NativeWebToolPolicyError extends Error {
  constructor(toolNames) {
    super(`Crawshrimp runtime policy rejected Session header native Web tools: ${toolNames.join(', ')}`)
    this.name = 'NativeWebToolPolicyError'
    this.code = 'NATIVE_WEB_TOOL_POLICY'
    this.toolNames = toolNames
  }
}

function nativeWebToolNamesInHeader(event) {
  if (event?.type !== 'request/header') return []
  const tools = Array.isArray(event?.data?.header?.tools) ? event.data.header.tools : []
  const present = new Set(tools.map((tool) => (
    typeof tool === 'string' ? tool : String(tool?.name || '')
  )))
  return NATIVE_WEB_TOOL_NAMES.filter((name) => present.has(name))
}

/** Reject every historical or live header that reintroduces generic Web tools. */
export function assertSessionHeadersExcludeNativeWebTools(events) {
  const found = new Set()
  for (const event of Array.isArray(events) ? events : [events]) {
    for (const name of nativeWebToolNamesInHeader(event)) found.add(name)
  }
  if (found.size) {
    throw new NativeWebToolPolicyError(NATIVE_WEB_TOOL_NAMES.filter((name) => found.has(name)))
  }
}

export class CrawshrimpSessionMigrationError extends Error {
  constructor(expected, actual) {
    super(`Session preset migration required: expected ${expected}, received ${actual || 'none'}`)
    this.name = 'CrawshrimpSessionMigrationError'
    this.code = 'SESSION_MIGRATION_REQUIRED'
    this.expected = expected
    this.actual = actual || null
  }
}

function profileTemplate(runtimeRoot) {
  for (const candidate of [join(runtimeRoot, 'profiles', 'web'), join(runtimeRoot, 'profile', 'web')]) {
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  throw new Error('DSH Web profile template is missing from the runtime')
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}

function writeProfilePackage(source, destination) {
  const template = readJson(source, {})
  const current = readJson(destination, {})
  const merged = {
    ...current,
    ...template,
    dependencies: {
      ...(current.dependencies || {}),
      ...(template.dependencies || {}),
    },
    dsh: template.dsh,
  }
  writeFileSync(destination, JSON.stringify(merged, null, 2) + '\n')
}

function linkProfilePackage(profileRoot, runtimeRoot, packagePath) {
  const target = join(runtimeRoot, 'node_modules', ...packagePath.split('/'))
  const destination = join(profileRoot, 'node_modules', ...packagePath.split('/'))
  if (!existsSync(target)) throw new Error('DSH runtime is missing profile dependency ' + packagePath)
  mkdirSync(dirname(destination), { recursive: true })
  rmSync(destination, { recursive: true, force: true })
  symlinkSync(target, destination, 'junction')
}

/**
 * Install/upgrade only product-owned profile files while retaining users'
 * independently added profile dependencies and all DSH_HOME state.
 */
export function ensureWebProfile({ runtimeRoot, dshHome }) {
  const source = profileTemplate(runtimeRoot)
  const destination = join(dshHome, 'profiles', 'web')
  mkdirSync(destination, { recursive: true })
  writeProfilePackage(join(source, 'package.json'), join(destination, 'package.json'))
  for (const file of PROFILE_FILES) {
    copyFileSync(join(source, file), join(destination, file))
  }
  // Product presets are evaluated from DSH_HOME after the launch capability
  // redirects the iframe. Refresh only this system-owned root on every boot;
  // user-authored presets under DSH_HOME/.agent-presets remain untouched.
  for (const file of PRODUCT_PRESET_FILES) {
    const target = join(destination, file)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(source, file), target)
  }
  for (const packagePath of PRODUCT_PROFILE_PACKAGES) {
    linkProfilePackage(destination, runtimeRoot, packagePath)
  }
  return destination
}

/**
 * Startup output is normally the only place the one-time browser launch URL
 * can surface before its cookie exchange.  Its query-key name is an upstream
 * detail, so redact the entire query rather than betting on `token`.
 */
export function redactWebDiagnostic(value) {
  return String(value).replace(/https?:\/\/[^\s)]+/gu, (rawUrl) => {
    try {
      const url = new URL(rawUrl)
      return url.search ? `${url.origin}${url.pathname}?<redacted>` : rawUrl
    } catch {
      return rawUrl.replace(/\?.*$/u, '?<redacted>')
    }
  })
}

function childHasExited(child) {
  return child.exitCode != null || child.signalCode != null || !child.pid
}

function waitForChildExit(child, timeoutMs) {
  if (childHasExited(child)) return Promise.resolve(true)
  return new Promise((resolveExit) => {
    const finish = (exited) => {
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      resolveExit(exited)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', onExit)
    if (childHasExited(child)) finish(true)
  })
}

async function stopChild(child, graceMs = 3000) {
  if (childHasExited(child)) return
  child.kill('SIGTERM')
  if (await waitForChildExit(child, graceMs)) return
  child.kill('SIGKILL')
  if (!await waitForChildExit(child, graceMs)) {
    throw new Error('DSH Web process did not exit after forced shutdown')
  }
}

function rpcFailure(method, body) {
  const error = body?.result?.error
  const detail = error?.message || JSON.stringify(error || body)
  return new Error('DSH Web RPC ' + method + ' failed: ' + detail)
}

/**
 * Session follow transports entries, not raw Session events.  The opening
 * snapshot may additionally contain packed chunk rows, while a live frame is
 * one `{ type: 'event', event }` envelope.  Project only the inner event so
 * downstream consumers receive the same shape for snapshot and live traffic.
 */
export function wireEvents(frame) {
  const eventForEntry = (entry) => (
    (entry?.type === 'event' || entry?.type === 'chunks')
      && entry.event
      && typeof entry.event === 'object'
      ? [entry.event]
      : []
  )
  if (frame?.type === 'snapshot') {
    return (Array.isArray(frame.records) ? frame.records : []).flatMap(eventForEntry)
  }
  return eventForEntry(frame)
}

/**
 * A Session follow snapshot contains prior as well as current events. Product
 * runs deliberately consume that whole history, but a newly attached native
 * Web shadow must never duplicate finished turns. Retain only the final
 * start-to-now span when the snapshot proves a turn is still active.
 */
export function activeTurnEvents(events) {
  const entries = Array.isArray(events) ? events.filter((event) => event && typeof event === 'object') : []
  let activeStart = -1
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index].type === 'turn/start') activeStart = index
    if (entries[index].type === 'turn/end') activeStart = -1
  }
  return activeStart < 0 ? [] : entries.slice(activeStart)
}

export class DshWebRuntime {
  #child
  #origin
  #cookie
  #launchUrl
  #runtimeToken
  #output = ''

  constructor({ child, origin, cookie, launchUrl, runtimeToken = '' }) {
    this.#child = child
    this.#origin = origin
    this.#cookie = cookie
    this.#launchUrl = launchUrl
    this.#runtimeToken = String(runtimeToken || '').trim()
  }

  static async launch({
    runtimeRoot,
    dshHome,
    nodeExecutable,
    cwd,
    env = {},
    port = 0,
    timeoutMs = 45000,
  }) {
    const root = resolve(runtimeRoot)
    const dshBin = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (!existsSync(dshBin)) throw new Error('DSH CLI entry is missing: ' + dshBin)
    ensureWebProfile({ runtimeRoot: root, dshHome })
    const requestedPort = Number(port)
    if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
      throw new Error('DSH Web port must be an integer from 0 to 65535')
    }
    const child = spawn(nodeExecutable, [
      dshBin, 'web', '--no-open', '--host', '127.0.0.1', '--port', String(requestedPort),
    ], {
      cwd,
      env: {
        ...process.env,
        ...env,
        ELECTRON_RUN_AS_NODE: '1',
        DSH_HOME: dshHome,
        DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED || '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const bootSignal = AbortSignal.timeout(timeoutMs)
    try {
      const launchUrl = await new Promise((resolveReady, rejectReady) => {
        let settled = false
        const fail = (error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          rejectReady(error)
        }
        const timer = setTimeout(() => {
          fail(new Error('DSH Web startup timed out: ' + redactWebDiagnostic(output).slice(-4000)))
        }, timeoutMs)
        const append = (chunk) => {
          output = (output + String(chunk)).slice(-20000)
          const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
          if (!match || settled) return
          settled = true
          clearTimeout(timer)
          resolveReady(match[1])
        }
        child.stdout.on('data', append)
        child.stderr.on('data', append)
        child.once('error', fail)
        child.once('exit', (code, signal) => {
          fail(new Error('DSH Web exited before ready: ' + String(code) + '/' + String(signal) + '\n' + redactWebDiagnostic(output).slice(-4000)))
        })
      })

      const exchange = await fetch(launchUrl, { redirect: 'manual', signal: bootSignal })
      const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0]
      if (exchange.status !== 303 || !cookie) {
        throw new Error('DSH Web launch token did not exchange for a browser cookie')
      }
      const runtime = new DshWebRuntime({
        child,
        origin: new URL(launchUrl).origin,
        cookie,
        launchUrl,
        runtimeToken: env.CRAWSHRIMP_MCP_TOKEN,
      })
      runtime.#output = output
      return runtime
    } catch (error) {
      await stopChild(child)
      throw error
    }
  }

  onExit(handler) {
    this.#child.on('exit', handler)
  }

  /**
   * A loopback-only launch URL that authenticates the embedded WebView. It is
   * deliberately exposed only to the trusted local host process; callers must
   * neither log it nor render it as visible UI text.
   */
  get launchUrl() {
    return this.#launchUrl
  }

  get origin() {
    return this.#origin
  }

  async request(method, args, signal) {
    const response = await fetch(this.#origin + '/api/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.#cookie },
      signal,
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'crawshrimp-' + randomUUID(),
        method,
        payload: { args },
      }),
    })
    let body
    try { body = await response.json() } catch {
      throw new Error('DSH Web RPC ' + method + ' returned HTTP ' + String(response.status))
    }
    if (!response.ok || body?.result?.ok !== true) throw rpcFailure(method, body)
    return body.result.value
  }

  async createSession({ sessionId, cwd, agentPreset = 'crawshrimp-standard' }) {
    const result = await this.request('session/create', { request: { sessionId, cwd, agentPreset } })
    if (result?.agentPreset !== agentPreset) {
      throw new CrawshrimpSessionMigrationError(agentPreset, result?.agentPreset)
    }
    return result
  }

  /**
   * Product sessions retain their own selected model.  Re-assert that choice
   * after a runtime restart (or a product-side model change), rather than
   * letting a persisted DSH Session silently reuse its prior model.
   */
  async selectModel({ sessionId, provider, model, reasoningEffort }) {
    const request = { sessionId, provider, model }
    if (reasoningEffort !== undefined) request.reasoningEffort = reasoningEffort
    const response = await fetch(this.#origin + '/api/crawshrimp/session/select-model', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.#cookie },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30000),
    })
    const result = await response.json()
    if (!response.ok || !result?.ok) {
      throw Object.assign(new Error(result?.error?.message || 'Session model selection failed'), { code: result?.error?.code })
    }
    return result
  }

  prompt({ sessionId, content, mode = 'queue', requestId = 'crawshrimp-' + randomUUID() }) {
    return this.request('session/prompt', {
      request: { requestId, sessionId, mode, content },
    })
  }

  /**
   * Request a Host-owned automatic continuation.  Unlike public session/prompt,
   * this requires the generation runtime token and the Host records a fixed
   * plugin source so it cannot be mistaken for a browser user's input.
   */
  async continueOutput({ sessionId, text }) {
    if (!this.#runtimeToken) throw new Error('DSH output continuation runtime token is unavailable')
    const response = await fetch(this.#origin + '/api/crawshrimp/session/output-continuation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: this.#cookie,
        'x-crawshrimp-runtime-token': this.#runtimeToken,
      },
      body: JSON.stringify({ sessionId, text }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body?.ok !== true) {
      throw new Error('DSH output continuation route failed: ' + String(body?.error?.message || body?.error || response.status))
    }
    return body
  }

  cancel(sessionId) {
    return this.request('session/cancel', { request: { sessionId } }, AbortSignal.timeout(5000))
  }

  /**
   * The product bridge is intentionally an HTTP route, not a public RPC
   * namespace.  rc.1 protects that route with the same browser session as the
   * rest of Web Host, so Python must not bypass the worker with a bare
   * loopback request.  Keeping the cookie here also lets the native approval
   * card be completed by either the embedded Web UI or dsh-im.
   */
  async requestApproval(payload) {
    const response = await fetch(this.#origin + '/api/crawshrimp/approval/request', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: this.#cookie,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Math.min(Math.max(Number(payload?.timeoutMs) || 0, 1), 30 * 60 * 1000)),
    })
    let body
    try { body = await response.json() } catch {
      throw new Error('DSH native approval route returned HTTP ' + String(response.status))
    }
    if (!response.ok || body?.ok !== true) {
      throw new Error('DSH native approval route failed: ' + String(body?.error || response.status))
    }
    return body
  }

  async setAutomationPolicy({ sessionId, runId, policy }) {
    const response = await fetch(this.#origin + '/api/crawshrimp/session/automation-policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.#cookie },
      body: JSON.stringify({ sessionId, runId, policy }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body?.ok !== true) {
      throw new Error('DSH Automation policy install failed: ' + String(body?.error?.message || body?.error || response.status))
    }
    return body
  }

  async clearAutomationPolicy({ sessionId, runId }) {
    const response = await fetch(this.#origin + '/api/crawshrimp/session/automation-policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.#cookie },
      body: JSON.stringify({ sessionId, runId, clear: true }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body?.ok !== true) {
      throw new Error('DSH Automation policy cleanup failed: ' + String(body?.error?.message || body?.error || response.status))
    }
    return body
  }

  /**
   * Open a scoped Session follow stream. The caller owns the returned close
   * handle; malformed/ended streams report through onError rather than being
   * treated as a successful end of an active run.
   */
  follow(sessionId, {
    onEvent, onError, onSnapshot, onSnapshotComplete,
    firstFrameTimeoutMs = 8000,
  } = {}) {
    const socket = new WebSocket(this.#origin.replace(/^http/u, 'ws') + '/api/remote.mux', {
      headers: { cookie: this.#cookie },
    })
    const streamId = 'crawshrimp-follow-' + randomUUID()
    let closed = false
    let lifecycle = 'connecting'
    let settled = false
    let errorNotified = false
    let firstFrameTimer = null
    let resolveReady
    let rejectReady
    const ready = new Promise((resolveReadyPromise, rejectReadyPromise) => {
      resolveReady = resolveReadyPromise
      rejectReady = rejectReadyPromise
    })
    const settleReady = () => {
      if (settled) return
      settled = true
      lifecycle = 'ready'
      if (firstFrameTimer) clearTimeout(firstFrameTimer)
      firstFrameTimer = null
      resolveReady()
    }
    const fail = (error) => {
      const failure = error instanceof Error ? error : new Error(String(error))
      if (lifecycle === 'failed' || lifecycle === 'closed') return
      lifecycle = 'failed'
      if (firstFrameTimer) clearTimeout(firstFrameTimer)
      firstFrameTimer = null
      if (!settled) {
        settled = true
        rejectReady(failure)
      }
      if (!errorNotified) {
        errorNotified = true
        onError?.(failure)
      }
      if (!closed) {
        closed = true
        try { socket.close() } catch {}
      }
    }
    socket.on('open', () => {
      socket.send(JSON.stringify({
        type: 'open',
        streamId,
        endpoint: 'session/follow',
        payload: {
          args: {
            request: { address: { kind: 'session', sessionId } },
          },
        },
      }))
    })
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(String(raw))
        if (message?.streamId !== streamId) return
        if (message.type === 'error') throw new Error('DSH Session follow rejected: ' + JSON.stringify(message.error))
        if (message.type === 'end') throw new Error('DSH Session follow ended unexpectedly')
        if (message.type !== 'item') return
        if (message.value?.type === 'snapshot') {
          const events = wireEvents(message.value)
          for (const event of events) onSnapshot?.(event)
          onSnapshotComplete?.(events)
          settleReady()
          return
        }
        settleReady()
        for (const event of wireEvents(message.value)) onEvent(event)
      } catch (error) {
        fail(error)
      }
    })
    socket.on('error', fail)
    socket.on('close', () => {
      if (!closed) fail(new Error('DSH Session follow socket closed unexpectedly'))
    })
    const boundedFirstFrameMs = Math.max(1, Number(firstFrameTimeoutMs) || 8000)
    firstFrameTimer = setTimeout(() => {
      fail(new Error(`DSH Session follow initial snapshot timed out after ${boundedFirstFrameMs}ms`))
    }, boundedFirstFrameMs)
    return {
      close: () => {
        if (closed) return
        closed = true
        lifecycle = 'closed'
        if (firstFrameTimer) clearTimeout(firstFrameTimer)
        firstFrameTimer = null
        if (!settled) {
          settled = true
          rejectReady(new Error('DSH Session follow was closed before its initial snapshot'))
        }
        try { socket.close() } catch {}
      },
      ready,
      get state() { return lifecycle },
    }
  }

  async stop({ graceMs = 3000 } = {}) {
    await stopChild(this.#child, graceMs)
  }
}
