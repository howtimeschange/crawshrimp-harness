// 抓虾产品桥(host 插件):把产品层(FastAPI/MCP 网关)的敏感操作审批
// 接入 DSH 原生审批交互 —— ctx.approval.request 触发 approval/asked 会话事件,
// apiproxy 建立 pending 并经原生 UI 呈现审批卡,用户决策后回传结果。
// FastAPI 侧经 HTTP 调用本插件的 /api/crawshrimp/approval/request。
import { AsyncLocalStorage } from 'node:async_hooks'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

export const name = 'crawshrimp-product-bridge'

export const inject = [
  'webServer',
  'approval',
  'agents',
  'tools',
  'connection',
  'apiProxy',
  'agentDefaultModel',
  'permissionPresets',
]

const MCP_TOOL_PREFIX = 'mcp__crawshrimp__'
const MCP_LEASE_HEADER = 'x-crawshrimp-mcp-lease'
export const DSH_IM_RETURN_FILE = 'dsh_im_return_file'
export const REMOTE_APPROVAL_DISABLED = 'REMOTE_APPROVAL_DISABLED'
export const IM_RPC_PREFIXES = Object.freeze([
  'feishu', 'weixin', 'dingtalk', 'wecom', 'qq', 'slack',
  'telegram', 'discord', 'whatsapp', 'office',
])
export const CRAWSHRIMP_IM_SESSION_REGISTRY = Symbol.for('CRAWSHRIMP_IM_SESSION_REGISTRY')
const IM_APPROVAL_GUARD = Symbol.for('crawshrimp.im-approval-guard')
const IM_CONNECTION_RPC_GUARD = Symbol.for('crawshrimp.im-connection-rpc-guard')
const mcpLeaseStorage = new AsyncLocalStorage()
let fetchBridgeInstalled = false
const APPROVAL_ARGUMENTS_MAX_CHARS = 4_500
const MODEL_CATALOG_TIMEOUT_MS = 10_000
const SESSION_SELECT_MODEL_TIMEOUT_MS = 30_000
const SESSION_PERMISSION_TIMEOUT_MS = 10_000

function imSessionRegistry() {
  if (!(globalThis[CRAWSHRIMP_IM_SESSION_REGISTRY] instanceof Set)) {
    Object.defineProperty(globalThis, CRAWSHRIMP_IM_SESSION_REGISTRY, {
      value: new Set(),
      configurable: false,
      enumerable: false,
      writable: false,
    })
  }
  return globalThis[CRAWSHRIMP_IM_SESSION_REGISTRY]
}

function remoteImApprovalsEnabled(env = process.env) {
  const value = String(env?.CRAWSHRIMP_IM_REMOTE_APPROVALS || '').trim()
  return !/^(0|false|no|off|disabled)$/i.test(value)
}

async function canonicalPath(path) {
  return realpath(resolve(String(path || '')))
}

async function isPathWithin(root, candidate) {
  try {
    const canonicalRoot = await canonicalPath(root)
    const unresolved = isAbsolute(String(candidate || ''))
      ? resolve(String(candidate))
      : resolve(canonicalRoot, String(candidate || ''))
    const canonicalCandidate = await canonicalPath(unresolved)
    const rel = relative(canonicalRoot, canonicalCandidate)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  } catch {
    return false
  }
}

export async function isImArtifactPathAllowed(workspaceRoot, requestedPath) {
  if (!String(workspaceRoot || '').trim() || !String(requestedPath || '').trim()) return false
  return isPathWithin(workspaceRoot, requestedPath)
}

function inputUrl(input) {
  try {
    return new URL(typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url || ''))
  } catch {
    return null
  }
}

function isImRpcId(value) {
  const rpcId = String(value || '')
  return IM_RPC_PREFIXES.some((prefix) => rpcId.startsWith(`${prefix}-`))
}

function cloneResponseWithJson(response, body) {
  const headers = new Headers(response.headers)
  headers.set('content-type', 'application/json')
  headers.delete('content-length')
  headers.delete('content-encoding')
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function rpcFailureResponse(request, code, message) {
  return new Response(JSON.stringify({
    type: 'server-response',
    rpcId: request.rpcId,
    result: { ok: false, error: { code, message } },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function jsonFromResponse(response) {
  try {
    return await response.clone().json()
  } catch {
    return null
  }
}

function responseValue(body) {
  return body?.result?.ok === true && body.result.value && typeof body.result.value === 'object'
    ? body.result.value
    : null
}

export function createImPolicyFetch(originalFetch, options = {}) {
  if (typeof originalFetch !== 'function') throw new TypeError('originalFetch must be a function')
  const workspaceRoot = String(options.workspaceRoot || process.env.CRAWSHRIMP_WORKSPACE_ROOT || '').trim()
  const sessionRegistry = options.sessionRegistry instanceof Set ? options.sessionRegistry : imSessionRegistry()
  const workspaceIds = new Set()

  const allowedWorkspaceItems = async (items) => {
    const rows = await Promise.all((Array.isArray(items) ? items : []).map(async (item) => (
      item && await isPathWithin(workspaceRoot, item.path) ? item : null
    )))
    const allowed = rows.filter(Boolean)
    for (const item of allowed) if (item.workspaceId) workspaceIds.add(String(item.workspaceId))
    return allowed
  }

  const allowedSessionItems = async (items) => {
    const rows = await Promise.all((Array.isArray(items) ? items : []).map(async (item) => (
      item && await isPathWithin(workspaceRoot, item.cwd) ? item : null
    )))
    return rows.filter(Boolean)
  }

  return async (input, init = {}) => {
    const url = inputUrl(input)
    let request
    try {
      request = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    } catch {
      request = null
    }
    const method = String(request?.method || '')
    if (!workspaceRoot || !url || !url.pathname.startsWith('/api/')
      || request?.type !== 'client-request' || !isImRpcId(request?.rpcId)) {
      return originalFetch(input, init)
    }

    const nextRequest = { ...request, payload: { ...(request.payload || {}) } }
    if (method === 'workspace.create') {
      nextRequest.payload.path = await canonicalPath(workspaceRoot)
    }
    if (method === 'session.create'
      && !workspaceIds.has(String(nextRequest.payload.workspaceId || ''))) {
      return rpcFailureResponse(request, 'IM_WORKSPACE_LOCKED', 'IM Sessions are restricted to the Crawshrimp workspace.')
    }
    const requestedSessionId = String(nextRequest.payload.sessionId || '')
    if (requestedSessionId && !sessionRegistry.has(requestedSessionId)) {
      const probe = {
        type: 'client-request',
        rpcId: `${request.rpcId}-scope-${Date.now()}`,
        method: 'session.list',
        payload: {},
      }
      const probeUrl = new URL('/api/session.list', url)
      const probeResponse = await originalFetch(probeUrl, {
        ...init,
        method: 'POST',
        body: JSON.stringify(probe),
      })
      const probeBody = await jsonFromResponse(probeResponse)
      const probeValue = responseValue(probeBody)
      const allowedProbeItems = await allowedSessionItems(probeValue?.items)
      if (!allowedProbeItems.some((item) => String(item?.sessionId || '') === requestedSessionId)) {
        return rpcFailureResponse(request, 'IM_SESSION_OUTSIDE_WORKSPACE', 'The Session is outside the Crawshrimp workspace.')
      }
      sessionRegistry.add(requestedSessionId)
    }
    const nextInit = { ...init, body: JSON.stringify(nextRequest) }
    const response = await originalFetch(input, nextInit)
    const body = await jsonFromResponse(response)
    const value = responseValue(body)
    if (!value) return response

    if (method === 'workspace.list') {
      value.items = await allowedWorkspaceItems(value.items)
      return cloneResponseWithJson(response, body)
    }
    if (method === 'workspace.create' && value.workspace?.workspaceId) {
      workspaceIds.add(String(value.workspace.workspaceId))
      if (value.workspace.path) value.workspace.path = await canonicalPath(workspaceRoot)
      return cloneResponseWithJson(response, body)
    }
    if (method === 'session.list') {
      value.items = await allowedSessionItems(value.items)
      return cloneResponseWithJson(response, body)
    }
    if (method === 'session.create' && value.sessionId) {
      sessionRegistry.add(String(value.sessionId))
    }
    const sessionId = String(nextRequest.payload.sessionId || '')
    if (sessionId && sessionRegistry.has(sessionId)) sessionRegistry.add(sessionId)
    return response
  }
}

export function installImApprovalGuard(approval, sessionRegistry = imSessionRegistry(), env = process.env) {
  if (!approval || typeof approval.decide !== 'function' || approval[IM_APPROVAL_GUARD]) return
  const originalDecide = approval.decide.bind(approval)
  Object.defineProperty(approval, IM_APPROVAL_GUARD, { value: true })
  approval.decide = async (req, session) => {
    const sessionId = String(req?.agent?.session?.id || session?.id || '')
    if (sessionRegistry.has(sessionId) && !remoteImApprovalsEnabled(env)) {
      return 'rejected'
    }
    return originalDecide(req, session)
  }
}

function pinImWorkspaceFields(value, workspaceRoot) {
  if (Array.isArray(value)) return value.map((item) => pinImWorkspaceFields(item, workspaceRoot))
  if (!value || typeof value !== 'object') return value
  const pinned = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'workspace') {
      pinned[key] = workspaceRoot
    } else if (key === 'workspaces' && child && typeof child === 'object' && !Array.isArray(child)) {
      pinned[key] = Object.fromEntries(Object.keys(child).map((alias) => [alias, workspaceRoot]))
    } else {
      pinned[key] = pinImWorkspaceFields(child, workspaceRoot)
    }
  }
  return pinned
}

export function installImConnectionRpcPolicy(ctx, workspaceRoot) {
  const rpc = ctx.connection?.rpc
  if (!rpc || typeof rpc.handle !== 'function' || rpc[IM_CONNECTION_RPC_GUARD] || !workspaceRoot) return
  const originalHandle = rpc.handle.bind(rpc)
  Object.defineProperty(rpc, IM_CONNECTION_RPC_GUARD, { value: true })
  rpc.handle = (channel, handler, options) => {
    const key = String(channel || '').replace(/^\//, '')
    if (!IM_RPC_PREFIXES.includes(key) || typeof handler !== 'function') {
      return originalHandle(channel, handler, options)
    }
    const guarded = async (endpoint, payload, signal) => {
      const nextPayload = pinImWorkspaceFields(payload, workspaceRoot)
      const result = await handler(endpoint, nextPayload, signal)
      return pinImWorkspaceFields(result, workspaceRoot)
    }
    return originalHandle(channel, guarded, options)
  }
}

function mcpUrlMatches(input) {
  const raw = String(process.env.CRAWSHRIMP_MCP_URL || '').trim()
  if (!raw) return false
  try {
    const target = new URL(raw)
    const inputUrl = new URL(
      typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url || ''),
    )
    return inputUrl.origin === target.origin && inputUrl.pathname === target.pathname
  } catch {
    return false
  }
}

function installMcpLeaseFetchBridge(ctx) {
  if (fetchBridgeInstalled || typeof globalThis.fetch !== 'function') return
  fetchBridgeInstalled = true
  const originalFetch = globalThis.fetch.bind(globalThis)
  const policyFetch = createImPolicyFetch(originalFetch, {
    workspaceRoot: process.env.CRAWSHRIMP_WORKSPACE_ROOT,
    sessionRegistry: imSessionRegistry(),
  })
  globalThis.fetch = async (input, init) => {
    const lease = mcpLeaseStorage.getStore()
    if (!lease?.lease_id || !mcpUrlMatches(input)) return policyFetch(input, init)
    const headers = new Headers(init?.headers || input?.headers || {})
    headers.set(MCP_LEASE_HEADER, String(lease.lease_id))
    return policyFetch(input, { ...(init || {}), headers })
  }
  ctx.logger?.info?.('Crawshrimp MCP lease and IM workspace fetch bridge installed')
}

async function postMcpContext(action, payload) {
  const raw = String(process.env.CRAWSHRIMP_MCP_URL || '').trim()
  const token = String(process.env.CRAWSHRIMP_MCP_TOKEN || '').trim()
  if (!raw || !token) throw new Error('CRAWSHRIMP_MCP_URL/token unavailable')
  const url = new URL(raw)
  url.pathname = `/context/${action}`
  url.search = ''
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result?.ok) {
      throw new Error(String(result?.detail || result?.error || `context ${action} failed (${response.status})`))
    }
    return result
  } finally {
    clearTimeout(timer)
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += String(chunk)
      if (raw.length > 1024 * 1024) {
        raw = ''
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve(null)
      }
    })
  })
}

function cappedJsonText(value, maxChars = APPROVAL_ARGUMENTS_MAX_CHARS) {
  if (value === undefined || value === null) return undefined
  let text
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  if (typeof text !== 'string') return undefined
  if (!text.trim() || text === 'null' || text === 'undefined') return undefined
  if (text.length <= maxChars) return value
  const suffix = `...(truncated, original length ${text.length})`
  return `${text.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`
}

export function approvalDisplayArgumentsFromBody(body) {
  if (!body || typeof body !== 'object') return undefined
  return cappedJsonText(body.arguments ?? body.toolArguments)
}

function crawshrimpBackendPort(env = process.env) {
  const port = Number.parseInt(String(env?.CRAWSHRIMP_PORT || '18765'), 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid CRAWSHRIMP_PORT for model catalog')
  }
  return port
}

export async function fetchCrawshrimpModelCatalog(fetchImpl = globalThis.fetch, env = process.env) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is unavailable')
  const token = String(env?.CRAWSHRIMP_API_TOKEN || '').trim()
  const headers = { accept: 'application/json' }
  if (token) headers['x-crawshrimp-token'] = token
  const signal = AbortSignal.timeout(MODEL_CATALOG_TIMEOUT_MS)
  const response = await fetchImpl(
    new URL('/agent/model-catalog', `http://127.0.0.1:${crawshrimpBackendPort(env)}`),
    { method: 'GET', headers, signal },
  )
  if (!response?.ok) {
    throw new Error(`Crawshrimp model catalog failed: HTTP ${response?.status || 0}`)
  }
  const body = await response.json()
  if (!body || body.ok !== true || !Array.isArray(body.groups)) {
    throw new Error('Crawshrimp model catalog returned an invalid response')
  }
  return body
}

function validSelection(value) {
  return value
    && typeof value === 'object'
    && typeof value.provider === 'string'
    && value.provider.length > 0
    && typeof value.model === 'string'
    && value.model.length > 0
    && (value.reasoningEffort === undefined
      || (typeof value.reasoningEffort === 'string' && value.reasoningEffort.length > 0))
}

function sameSelection(left, right) {
  return left?.provider === right?.provider
    && left?.model === right?.model
    && left?.reasoningEffort === right?.reasoningEffort
}

function apiProxyRequest(method, payload) {
  return {
    type: 'client-request',
    rpcId: `crawshrimp-${method}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    method,
    payload,
  }
}

function apiProxyFailure(error, fallbackCode = 'internal') {
  return {
    code: String(error?.code || error?.failure?.code || fallbackCode),
    message: String(error?.message || error?.failure?.message || error || 'operation failed'),
    ...(error?.details && typeof error.details === 'object' ? { details: error.details } : {}),
  }
}

function permissionService(ctx) {
  const service = ctx?.permissionPresets
  if (!service
    || !Array.isArray(service.names)
    || typeof service.current !== 'function'
    || (typeof service.apply !== 'function' && typeof service.set !== 'function')) {
    return null
  }
  return service
}

function sessionPermissionPayload(ctx, agent) {
  const service = permissionService(ctx)
  if (!service) {
    return { ok: false, status: 501, error: { code: 'unsupported', message: 'session permission service is unavailable' } }
  }
  const preset = service.current(agent.session.events)
  return {
    ok: true,
    status: 200,
    preset,
    available: [...service.names],
    policy: typeof ctx?.approval?.effectivePolicy === 'function'
      ? ctx.approval.effectivePolicy(agent.session)
      : undefined,
  }
}

export async function getCrawshrimpSessionPermission(ctx, sessionId) {
  const id = String(sessionId || '')
  if (!id) {
    return { ok: false, status: 400, error: { code: 'bad-request', message: 'sessionId required' } }
  }
  const agent = findLiveAgent(ctx, id)
  if (agent === undefined) {
    return { ok: false, status: 409, error: { code: 'NO_LIVE_AGENT', message: 'No live agent for this session' } }
  }
  return sessionPermissionPayload(ctx, agent)
}

export async function setCrawshrimpSessionPermission(ctx, body) {
  const sessionId = String(body?.sessionId || '')
  const preset = String(body?.preset || '')
  if (!sessionId || !preset) {
    return { ok: false, status: 400, error: { code: 'bad-request', message: 'sessionId/preset required' } }
  }
  const service = permissionService(ctx)
  if (!service) {
    return { ok: false, status: 501, error: { code: 'unsupported', message: 'session permission service is unavailable' } }
  }
  if (!service.names.includes(preset)) {
    return {
      ok: false,
      status: 400,
      error: { code: 'unknown-preset', message: `Unknown permission preset "${preset}"` },
    }
  }
  const agent = findLiveAgent(ctx, sessionId)
  if (agent === undefined) {
    return { ok: false, status: 409, error: { code: 'NO_LIVE_AGENT', message: 'No live agent for this session' } }
  }
  const previous = service.current(agent.session.events)
  if (typeof service.apply === 'function' && typeof ctx?.approval?.setPolicy === 'function') {
    service.apply(agent.session, preset, (policy) => {
      ctx.approval.setPolicy(agent, policy)
    })
  } else {
    service.set(agent.session, preset)
  }
  const current = service.current(agent.session.events)
  if (current !== preset) {
    return {
      ok: false,
      status: 500,
      error: { code: 'permission-readback-mismatch', message: 'Session permission readback did not match the requested preset' },
    }
  }
  const payload = sessionPermissionPayload(ctx, agent)
  return { ...payload, previous }
}

export async function selectCrawshrimpSessionModel(ctx, body) {
  const selection = {
    provider: String(body?.provider || ''),
    model: String(body?.model || ''),
    ...(body?.reasoningEffort === undefined ? {} : { reasoningEffort: String(body.reasoningEffort) }),
  }
  const sessionId = String(body?.sessionId || '')
  if (!sessionId || !validSelection(selection)) {
    return { ok: false, status: 400, error: { code: 'bad-request', message: 'sessionId/provider/model required' } }
  }
  if (!ctx?.apiProxy?.sessions || typeof ctx.apiProxy.sessions.selectModel !== 'function') {
    return { ok: false, status: 501, error: { code: 'unsupported', message: 'session model selection is unavailable' } }
  }
  if (!ctx?.agentDefaultModel
    || typeof ctx.agentDefaultModel.currentSelection !== 'function'
    || typeof ctx.agentDefaultModel.saveSelection !== 'function') {
    return { ok: false, status: 501, error: { code: 'unsupported', message: 'default model restore is unavailable' } }
  }

  const previousDefault = ctx.agentDefaultModel.currentSelection()
  if (!validSelection(previousDefault)) {
    return { ok: false, status: 500, error: { code: 'invalid-default-model', message: 'current default model is invalid' } }
  }

  let response
  try {
    response = await ctx.apiProxy.sessions.selectModel(apiProxyRequest('session.selectModel', {
      sessionId,
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    }))
  } catch (error) {
    return { ok: false, status: 500, error: apiProxyFailure(error) }
  } finally {
    const currentDefault = ctx.agentDefaultModel.currentSelection()
    if (!sameSelection(currentDefault, previousDefault)) {
      await ctx.agentDefaultModel.saveSelection(previousDefault)
    }
  }

  if (response?.result?.ok !== true) {
    return {
      ok: false,
      status: 200,
      error: apiProxyFailure(response?.result?.error, 'model-unavailable'),
    }
  }
  const selected = response.result.value?.selected
  if (!validSelection(selected)) {
    return { ok: false, status: 500, error: { code: 'invalid-response', message: 'Harness returned an invalid selected model' } }
  }
  return { ok: true, status: 200, selected }
}

function findLiveAgent(ctx, sessionId) {
  const agents = ctx.agents
  if (!agents) return undefined
  for (const agent of agents.roots() || []) {
    if (String(agent?.session?.id) === String(sessionId)) return agent
  }
  return undefined
}

export function apply(ctx) {
  const sessionRegistry = imSessionRegistry()
  const workspaceRoot = String(process.env.CRAWSHRIMP_WORKSPACE_ROOT || '').trim()
  installMcpLeaseFetchBridge(ctx)
  installImApprovalGuard(ctx.approval, sessionRegistry)
  installImConnectionRpcPolicy(ctx, workspaceRoot)

  // DSH 的 MCP transport 是 runtime 级单连接，请求上没有 session header。
  // tools/execute 的 exec.agent.id 是可靠会话身份：先租用后端对应 run 上下文，
  // 再执行真实 MCP HTTP 调用，finally 释放。lease 通过 fetch bridge 仅绑定本次调用链。
  ctx.on('tools/execute', async (exec, next) => {
    const toolName = String(exec?.name || '')
    if (toolName === DSH_IM_RETURN_FILE) {
      const requestedPath = String(exec.arguments?.path || '')
      if (!await isImArtifactPathAllowed(workspaceRoot, requestedPath)) {
        const error = new Error('IM returned files must stay inside the active Crawshrimp workspace.')
        error.code = 'IM_ARTIFACT_OUTSIDE_WORKSPACE'
        throw error
      }
      return next()
    }
    if (!toolName.startsWith(MCP_TOOL_PREFIX)) return next()
    const runtimeSessionId = String(exec.agent?.id || '')
    if (!runtimeSessionId) throw new Error('Crawshrimp MCP tool missing agent session')
    const lease = await postMcpContext('acquire', {
      runtime_session_id: runtimeSessionId,
      call_id: String(exec.callId || ''),
    })
    try {
      return await mcpLeaseStorage.run(lease, async () => await next())
    } finally {
      try {
        await postMcpContext('release', { lease_id: lease.lease_id })
      } catch (error) {
        ctx.logger?.error?.(`Crawshrimp MCP context release failed: ${String(error?.message || error)}`)
      }
    }
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/crawshrimp',
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      if (url.pathname === '/api/crawshrimp/model-catalog' && req.method === 'GET') {
        try {
          const catalog = await fetchCrawshrimpModelCatalog()
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify(catalog))
        } catch (error) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }))
        }
        return
      }
      if (url.pathname === '/api/crawshrimp/session/select-model' && req.method === 'POST') {
        try {
          const body = await readBody(req)
          const result = await Promise.race([
            selectCrawshrimpSessionModel(ctx, body),
            new Promise((_, reject) => {
              setTimeout(() => reject(Object.assign(new Error('session model selection timed out'), {
                code: 'timeout',
              })), SESSION_SELECT_MODEL_TIMEOUT_MS)
            }),
          ])
          res.writeHead(result.status ?? (result.ok ? 200 : 500), {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          })
          res.end(JSON.stringify(result.ok
            ? { ok: true, selected: result.selected }
            : { ok: false, error: result.error }))
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ ok: false, error: apiProxyFailure(error) }))
        }
        return
      }
      if (url.pathname === '/api/crawshrimp/session/permission'
        && (req.method === 'GET' || req.method === 'POST' || req.method === 'PATCH')) {
        try {
          const body = req.method === 'GET'
            ? { sessionId: url.searchParams.get('sessionId') }
            : await readBody(req)
          const operation = req.method === 'GET'
            ? getCrawshrimpSessionPermission(ctx, body.sessionId)
            : setCrawshrimpSessionPermission(ctx, body)
          const result = await Promise.race([
            operation,
            new Promise((_, reject) => {
              setTimeout(() => reject(Object.assign(new Error('session permission operation timed out'), {
                code: 'timeout',
              })), SESSION_PERMISSION_TIMEOUT_MS)
            }),
          ])
          res.writeHead(result.status ?? (result.ok ? 200 : 500), {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          })
          res.end(JSON.stringify(result.ok
            ? {
              ok: true,
              preset: result.preset,
              available: result.available,
              previous: result.previous,
              ...(result.policy === undefined ? {} : { policy: result.policy }),
            }
            : { ok: false, error: result.error }))
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ ok: false, error: apiProxyFailure(error) }))
        }
        return
      }
      if (url.pathname !== '/api/crawshrimp/approval/request' || req.method !== 'POST') {
        res.writeHead(404)
        res.end('not found')
        return
      }
      const body = await readBody(req)
      const sessionId = String(body?.sessionId ?? '')
      const toolName = String(body?.toolName ?? '')
      const reason = String(body?.reason ?? '')
      const callId = body?.callId != null ? String(body.callId) : undefined
      const approvalArguments = approvalDisplayArgumentsFromBody(body)
      const timeoutMs = Math.min(Math.max(Number(body?.timeoutMs) || 0, 0), 30 * 60 * 1000)
      if (!sessionId || !toolName) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'sessionId/toolName required' }))
        return
      }
      const agent = findLiveAgent(ctx, sessionId)
      if (agent === undefined) {
        res.writeHead(409, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'NO_LIVE_AGENT' }))
        return
      }
      const controller = new AbortController()
      const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null
      try {
        // IM 用户看不到桌面端审批卡；默认仍走 DSH 原生审批交互，
        // 由 dsh-im 的同 route/同 actor 队列接收自然语言“确认/拒绝”。
        if (sessionRegistry.has(sessionId) && !remoteImApprovalsEnabled()) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, outcome: 'rejected', code: REMOTE_APPROVAL_DISABLED }))
          return
        }
        // DSH 会话权限是统一真值：never 表示用户已整体放开，抓虾审批自动
        // allowed-once（FastAPI 侧仍保留审批审计）；ask 才展示原生审批卡。
        const policy = ctx.approval.effectivePolicy(agent.session)
        if (policy === 'never') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, outcome: 'allowed-once' }))
          return
        }
        const outcome = await ctx.approval.request({
          agent,
          toolName,
          ...(callId ? { callId } : {}),
          reason,
          ...(approvalArguments === undefined ? {} : { arguments: approvalArguments }),
          signal: controller.signal,
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, outcome }))
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }))
      } finally {
        if (timer) clearTimeout(timer)
      }
    },
  }), 'crawshrimp-bridge: routes')
}
