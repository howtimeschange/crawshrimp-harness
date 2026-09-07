import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WebSocketServer } from 'ws'

import {
  CrawshrimpSessionMigrationError,
  DshWebRuntime,
  ensureWebProfile,
} from './web-rpc-client.mjs'

test('fresh Web profiles copy both the product preset composition and metadata, idempotently', (t) => {
  const runtimeRoot = mkdtempSync(join(tmpdir(), 'crawshrimp-web-profile-'))
  t.after(() => rmSync(runtimeRoot, { recursive: true, force: true }))

  const sourceProfile = join(runtimeRoot, 'profiles', 'web')
  const sourcePreset = join(sourceProfile, 'agent-presets', 'crawshrimp-standard')
  mkdirSync(sourcePreset, { recursive: true })
  writeFileSync(join(sourceProfile, 'package.json'), '{"name":"fixture-profile"}\n')
  writeFileSync(join(sourceProfile, 'cordis.yml'), 'cordis: fixture\n')
  writeFileSync(join(sourceProfile, 'cordis.patch.yml'), 'patch: fixture\n')
  writeFileSync(join(sourceProfile, 'pnpm-workspace.yaml'), 'packages: []\n')
  writeFileSync(join(sourcePreset, 'agent.cordis.yml'), 'composition: fixture\n')
  writeFileSync(join(sourcePreset, 'preset.yml'), 'name: Fixture\ndescription: Metadata\n')

  for (const packagePath of ['@xmanrui/dsh-im', 'crawshrimp-product-bridge', 'crawshrimp-slots']) {
    const packageRoot = join(runtimeRoot, 'node_modules', ...packagePath.split('/'))
    mkdirSync(packageRoot, { recursive: true })
    writeFileSync(join(packageRoot, 'package.json'), '{}\n')
  }

  const dshHome = join(runtimeRoot, 'home')
  const profile = ensureWebProfile({ runtimeRoot, dshHome })
  const targetPreset = join(profile, 'agent-presets', 'crawshrimp-standard')
  const expectedFiles = ['agent.cordis.yml', 'preset.yml']
  for (const file of expectedFiles) {
    assert.equal(
      readFileSync(join(targetPreset, file), 'utf8'),
      readFileSync(join(sourcePreset, file), 'utf8'),
      `copied ${file}`,
    )
  }

  ensureWebProfile({ runtimeRoot, dshHome })
  for (const file of expectedFiles) {
    assert.equal(readFileSync(join(targetPreset, file), 'utf8'), readFileSync(join(sourcePreset, file), 'utf8'))
  }
})

test('createSession retains the preset migration guard', async (t) => {
  const server = createServer((request, response) => {
    assert.equal(request.url, '/api/session/create')
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      result: {
        ok: true,
        value: { agentPreset: 'legacy-standard' },
      },
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => await new Promise((resolve) => server.close(resolve)))

  const child = new EventEmitter()
  child.exitCode = 0
  const runtime = new DshWebRuntime({
    child,
    origin: `http://127.0.0.1:${server.address().port}`,
    cookie: 'dsh=trusted-browser-cookie',
    launchUrl: '',
  })

  await assert.rejects(
    runtime.createSession({
      sessionId: 'web-session:migration',
      cwd: '/tmp/workspace',
      agentPreset: 'crawshrimp-standard',
    }),
    (error) => {
      assert.ok(error instanceof CrawshrimpSessionMigrationError)
      assert.equal(error.code, 'SESSION_MIGRATION_REQUIRED')
      assert.equal(error.expected, 'crawshrimp-standard')
      assert.equal(error.actual, 'legacy-standard')
      return true
    },
  )
})

test('native Web follow closes and rejects when the socket never sends its first snapshot', async (t) => {
  const server = new WebSocketServer({ port: 0 })
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(async () => {
    for (const client of server.clients) client.terminate()
    await new Promise((resolve) => server.close(resolve))
  })
  const port = server.address().port
  const child = new EventEmitter()
  child.exitCode = 0
  const runtime = new DshWebRuntime({
    child,
    origin: `http://127.0.0.1:${port}`,
    cookie: 'dsh=test',
    launchUrl: '',
  })

  const follow = runtime.follow('web-session:never-ready', { firstFrameTimeoutMs: 25 })
  await assert.rejects(follow.ready, /initial snapshot timed out/)
  assert.equal(follow.state, 'failed')
})

test('output continuation sends the runtime token and a text-only body to the private Host route', async (t) => {
  let received
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      received = {
        method: request.method,
        url: request.url,
        cookie: request.headers.cookie,
        runtimeToken: request.headers['x-crawshrimp-runtime-token'],
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, messageId: 'continuation-message' }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => await new Promise((resolve) => server.close(resolve)))

  const child = new EventEmitter()
  child.exitCode = 0
  const runtime = new DshWebRuntime({
    child,
    origin: `http://127.0.0.1:${server.address().port}`,
    cookie: 'dsh=trusted-browser-cookie',
    launchUrl: '',
    runtimeToken: 'runtime-only-secret',
  })

  const result = await runtime.continueOutput({
    sessionId: 'web-session:continue',
    text: '只输出上一段之后的内容。',
  })

  assert.deepEqual(result, { ok: true, messageId: 'continuation-message' })
  assert.deepEqual(received, {
    method: 'POST',
    url: '/api/crawshrimp/session/output-continuation',
    cookie: 'dsh=trusted-browser-cookie',
    runtimeToken: 'runtime-only-secret',
    body: {
      sessionId: 'web-session:continue',
      text: '只输出上一段之后的内容。',
    },
  })
})
