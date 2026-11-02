'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { diagnosticFetch, oauthFailure, inferenceFailure } = require('./managedDiagnostics')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

test('inference failures correlate safe transport stages without credentials or payloads', () => {
  const failure = new Error('secret URL and image prompt', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT', token: 'secret' } })
  const requestId = 'abcdefab-1234-1234-1234-abcdefabcdef'
  assert.deepEqual(inferenceFailure(failure, { requestId }), { requestId, phase: 'headers', transportCode: 'UND_ERR_CONNECT_TIMEOUT' })
  const body = inferenceFailure(failure, { requestId, headersReceived: true, startedAt: performance.now() })
  assert.equal(body.phase, 'body'); assert.ok(body.totalMs >= 0)
  const unsafe = inferenceFailure(new Error('secret', { cause: { code: 'secret' } }), { requestId: 'secret' })
  assert.equal(unsafe.requestId, null); assert.equal(unsafe.transportCode, 'UNKNOWN')
  assert.ok(!JSON.stringify([body, unsafe]).includes('secret'))
})

test('diagnostics separate delayed headers from delayed body, preserve bytes and send once', async () => {
  const events = []; let calls = 0; let sentId
  const run = diagnosticFetch(async (_url, options) => {
    calls++; sentId = options.headers.get('x-request-id')
    await pause(20)
    return new Response(new ReadableStream({ async start(c) {
      await pause(40); c.enqueue(new TextEncoder().encode('data: secret-prompt\n\n')); c.close()
    } }), { headers: { 'content-type': 'text/event-stream' } })
  }, { enabled: () => true, emit: event => events.push(event) })
  const response = await run('https://fixture.invalid/account/inference/v1/responses', { headers: { 'X-Request-Id': 'abcdefab-1234-1234-1234-abcdefabcdef', Authorization: 'Bearer secret' } })
  assert.equal(await response.text(), 'data: secret-prompt\n\n')
  assert.equal(calls, 1); assert.equal(events.length, 1)
  assert.equal(events[0].requestId, sentId)
  assert.ok(events[0].headersMs >= 15)
  assert.ok(events[0].firstByteMs - events[0].headersMs >= 20)
  assert.equal(events[0].outcome, 'consumed')
  assert.ok(!JSON.stringify(events).includes('secret'))
})

test('disabled diagnostics preserve response identity and do not consume the body', async () => {
  const response = new Response('secret')
  const run = diagnosticFetch(async () => response, { enabled: () => false, emit: () => assert.fail() })
  assert.equal(await run('https://fixture.invalid/oidc/token'), response)
  assert.equal(response.bodyUsed, false)
})

test('transport failures retain the original error with no retry and safe code only', async () => {
  for (const code of ['ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'secret']) {
    let calls = 0; const events = []
    const failure = new Error('secret URL and token', { cause: { code } })
    const run = diagnosticFetch(async () => { calls++; throw failure }, { enabled: () => true, emit: e => events.push(e) })
    await assert.rejects(run('https://fixture.invalid/oidc/token?secret'), error => error === failure)
    assert.equal(calls, 1)
    assert.equal(events[0].transportCode, code === 'secret' ? 'UNKNOWN' : code)
    assert.ok(!JSON.stringify(events).includes('secret'))
  }
})

test('OAuth error records status, correlation and allowlisted field types without values', async () => {
  const run = diagnosticFetch(async () => new Response('{}', { status: 400, headers: { 'content-type': 'application/json; charset=utf-8', 'set-cookie': 'secret' } }), { enabled: () => false })
  const response = await run('https://fixture.invalid/oidc/token')
  const diagnostic = oauthFailure({ code: 'OAUTH_RESPONSE_BODY_ERROR', error: 'invalid_grant', response, cause: { error: 'invalid_grant', error_description: 'secret auth code', secret: 'secret-token', access_token: 'secret' } })
  assert.equal(diagnostic.status, 400); assert.equal(diagnostic.reason, 'invalid_grant')
  assert.equal(diagnostic.contentType, 'application/json')
  assert.match(diagnostic.requestId, /^[a-f0-9-]{36}$/)
  assert.deepEqual(diagnostic.bodyShape, { error: 'string', error_description: 'string' })
  assert.ok(!JSON.stringify(diagnostic).includes('secret'))
})

test('body disconnect and consumer cancellation propagate without retry', async () => {
  const events = []; let calls = 0; let cancelled = false
  const failure = new Error('secret', { cause: { code: 'UND_ERR_SOCKET' } })
  const run = diagnosticFetch(async () => { calls++; return new Response(new ReadableStream({ pull(c) { c.error(failure) } })) }, { enabled: () => true, emit: e => events.push(e) })
  await assert.rejects((await run('https://fixture.invalid/oidc/token')).text(), e => e === failure)
  assert.equal(calls, 1); assert.equal(events[0].outcome, 'body-error')
  const cancel = diagnosticFetch(async () => new Response(new ReadableStream({ cancel() { cancelled = true } })), { enabled: () => true, emit: e => events.push(e) })
  await (await cancel('https://fixture.invalid/oidc/token')).body.cancel()
  assert.equal(cancelled, true); assert.equal(events[1].outcome, 'cancelled')
  assert.ok(!JSON.stringify(events).includes('secret'))
})

test('diagnostic sink failure cannot alter the response', async () => {
  const run = diagnosticFetch(async () => new Response('ok'), { enabled: () => true, emit: () => { throw new Error('sink failed') } })
  assert.equal(await (await run('https://fixture.invalid/oidc/token')).text(), 'ok')
})

test('actual OIDC client distinguishes OAuth JSON rejection from HTML gateway failure, with one exchange', async () => {
  const oidc = await import('openid-client')
  for (const [status, type, body, reason] of [
    [400, 'application/json', JSON.stringify({ error: 'invalid_grant', error_description: 'secret' }), 'invalid_grant'],
    [502, 'text/html', '<html>secret gateway</html>', 'unclassified'],
  ]) {
    let calls = 0
    const config = new oidc.Configuration({ issuer: 'https://fixture.invalid', token_endpoint: 'https://fixture.invalid/token' }, 'fixture', undefined, oidc.None())
    config[oidc.customFetch] = diagnosticFetch(async () => { calls++; return new Response(body, { status, headers: { 'content-type': type } }) }, { enabled: () => true, emit: () => {} })
    let failure
    try { await oidc.authorizationCodeGrant(config, new URL('http://127.0.0.1/callback?code=secret&state=fixture'), { expectedState: 'fixture', pkceCodeVerifier: 'fixture' }) } catch (error) { failure = error }
    assert.ok(failure); assert.equal(calls, 1)
    const diagnostic = oauthFailure(failure)
    assert.equal(diagnostic.status, status)
    assert.equal(diagnostic.contentType, type)
    assert.equal(diagnostic.reason, reason)
    assert.ok(!JSON.stringify(diagnostic).includes('secret'))
  }
})

test('first SSE byte is distinct from first visible text; split frames preserve bytes and privacy', async () => {
  for (const payload of [JSON.stringify({ type: 'response.output_text.delta', delta: 'secret-text' }), JSON.stringify({ choices: [{ delta: { content: 'secret-text' } }] })]) {
    const events = []; const encoder = new TextEncoder()
    const input = ': keepalive\r\n\r\ndata: '+payload+'\r\n\r\n'
    const run = diagnosticFetch(async () => new Response(new ReadableStream({ async start(c) {
      c.enqueue(encoder.encode(': keepalive\r\n\r\n'))
      await pause(30)
      c.enqueue(encoder.encode('data: '+payload.slice(0, 12)))
      c.enqueue(encoder.encode(payload.slice(12)+'\r\n\r\n')); c.close()
    } }), { headers: { 'content-type': 'text/event-stream' } }), { enabled: () => true, emit: e => events.push(e) })
    assert.equal(await (await run('https://fixture.invalid/account/inference/v1/responses')).text(), input)
    assert.equal(events[0].textObservation, 'observed')
    assert.ok(events[0].firstTextMs - events[0].firstByteMs >= 15)
    assert.ok(!JSON.stringify(events).includes('secret'))
  }
})

test('oversize or non-text SSE does not claim first text and never changes stream delivery', async () => {
  for (const [input, expected] of [['data: '+ 'x'.repeat(17000), 'inspection-limit'], ['data: {"type":"response.created"}\n\ndata: [DONE]\n\n', 'no-text-observed']]) {
    const events = []
    const run = diagnosticFetch(async () => new Response(input, { headers: { 'content-type': 'text/event-stream' } }), { enabled: () => true, emit: e => events.push(e) })
    assert.equal(await (await run('https://fixture.invalid/account/inference/v1/responses')).text(), input)
    assert.equal(events[0].firstTextMs, undefined)
    assert.equal(events[0].textObservation, expected)
  }
})

test('campaign marker is restricted to configured origin and target routes and stops at expiry', async () => {
  const observed=[];let active=true
  const run=diagnosticFetch(async (url,options)=>{observed.push({url:String(url),marker:options.headers.get('x-harness-diagnostic-run')});return new Response('{}')},{enabled:()=>active,campaign:'11111111-1111-4111-8111-111111111111',allowedOrigin:'https://fixture.invalid',emit:()=>{},onHeaders:()=>{throw new Error('fixture observer failure')}})
  for(const url of ['https://fixture.invalid/oidc/token','https://other.invalid/oidc/token','https://fixture.invalid/account/models'])await(await run(url,{headers:{'x-harness-diagnostic-run':'injected'}})).text()
  active=false;await(await run('https://fixture.invalid/oidc/token')).text()
  assert.deepEqual(observed.map(x=>x.marker),['11111111-1111-4111-8111-111111111111',null,null,null])
})

test('stream closure has a safe distinct code', () => {
  assert.equal(inferenceFailure(Object.assign(new Error('private'), { code: 'ERR_STREAM_PREMATURE_CLOSE' })).transportCode, 'ERR_STREAM_PREMATURE_CLOSE')
})
