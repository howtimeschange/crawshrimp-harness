'use strict'
const { randomUUID } = require('node:crypto')
const { withConnectionTiming } = require('./managedConnectionTiming')

const oauthErrors = new Set(['invalid_grant', 'access_denied', 'invalid_request', 'invalid_client', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope', 'server_error', 'temporarily_unavailable'])
const transportCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'])
const responses = new WeakMap()
const failures = new WeakMap()
function mediaType(headers) {
  const value = headers?.get('content-type')?.split(';')[0].trim().toLowerCase()
  return ['application/json', 'application/problem+json', 'text/html', 'text/plain', 'text/event-stream'].includes(value) ? value : 'other'
}
function transportCode(error) {
  const code = error?.cause?.code || error?.code
  return transportCodes.has(code) ? code : ['AbortError', 'TimeoutError'].includes(error?.name) ? error.name : 'UNKNOWN'
}

// This is first visible text, not a tokenizer-level token or reasoning/tool event.
// Retain at most 16K characters of an incomplete SSE frame between chunks,
// and stop inspecting after 64 KiB. Unknown/large formats remain unobserved.
function textObserver(event, elapsed) {
  const decoder = new TextDecoder()
  let buffer = '', inspected = 0, stopped = false
  event.textObservation = 'no-text-observed'
  return chunk => {
    if (stopped) return
    inspected += chunk.byteLength
    if (inspected > 65536) { stopped = true; buffer = ''; event.textObservation = 'inspection-limit'; return }
    buffer += decoder.decode(chunk, { stream: true })
    let delimiter
    while ((delimiter = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, delimiter.index); buffer = buffer.slice(delimiter.index + delimiter[0].length)
      const payload = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      if (payload.length > 16384) { stopped = true; buffer = ''; event.textObservation = 'inspection-limit'; return }
      try {
        const value = JSON.parse(payload)
        const text = value.type === 'response.output_text.delta' ? value.delta : value.choices?.find(choice => typeof choice?.delta?.content === 'string' && choice.delta.content.length)?.delta.content
        if (typeof text === 'string' && text.length) { event.firstTextMs = elapsed(); event.textObservation = 'observed'; stopped = true; buffer = ''; return }
      } catch {}
    }
    if (buffer.length > 16384) { stopped = true; buffer = ''; event.textObservation = 'inspection-limit' }
  }
}
function oauthFailure(error) {
  const response = error?.response || (error?.cause instanceof Response ? error.cause : undefined)
  const body = error?.cause
  return {
    timestamp: new Date().toISOString(),
    ...failures.get(error),
    ...failures.get(error?.cause),
    ...responses.get(response),
    code: ['OAUTH_RESPONSE_BODY_ERROR', 'OAUTH_AUTHORIZATION_RESPONSE_ERROR', 'OAUTH_INVALID_RESPONSE', 'OAUTH_PARSE_ERROR'].includes(error?.code) ? error.code : 'UNKNOWN',
    reason: oauthErrors.has(error?.error) ? error.error : 'unclassified',
    status: Number.isInteger(response?.status) ? response.status : null,
    contentType: mediaType(response?.headers),
    // Never serialize arbitrary keys, descriptions, URLs, headers or token values.
    bodyShape: Object.fromEntries(['error', 'error_description', 'error_uri'].filter(k => Object.hasOwn(body || {}, k)).map(k => [k, typeof body[k]])),
    transportCode: transportCode(error),
  }
}

// Observe the consumed stream, not a cloned/tee'd body: bounded memory and no
// extra read, buffering, timeout, or automatic retry on the inference path.
function diagnosticFetch(fetcher, { enabled = () => process.env.CRAWSHRIMP_MANAGED_TIMINGS === '1', emit = event => console.info('[managed-network-timing]', JSON.stringify(event)), route: fixedRoute, onHeaders, campaign, allowedOrigin, traceConnections = false } = {}) {
  return async (url, options = {}) => {
    const target = new URL(url)
    const route = fixedRoute || (target.pathname.startsWith('/account/inference/') ? 'inference' : target.pathname.endsWith('/token') ? 'oauth-token' : target.pathname.includes('openid-configuration') ? 'oauth-discovery' : 'account')
    const active = enabled()
    const started = performance.now()
    const headers = new Headers(options.headers)
    if(campaign){headers.delete('X-Harness-Diagnostic-Run');if(active&&target.origin===allowedOrigin&&['oauth-token','inference'].includes(route))headers.set('X-Harness-Diagnostic-Run',campaign)}
    const requestId = route === 'inference' ? headers.get('x-request-id') : randomUUID()
    if (route !== 'inference') headers.set('X-Request-Id', requestId)
    const event = { timestamp: new Date().toISOString(), requestId: /^[a-f0-9-]{36}$/.test(requestId || '') ? requestId : null, route }
    const elapsed = () => Math.round(performance.now() - started)
    const publish = () => { if (active) { try { emit({ ...event }) } catch {} } }
    try {
      const request=()=>fetcher(url, { ...options, headers })
      const response = await (active&&traceConnections?withConnectionTiming(event,started,request):request())
      Object.assign(event, { headersMs: elapsed(), status: response.status, contentType: mediaType(response.headers) })
      responses.set(response, { requestId: event.requestId, route, startedAt: event.timestamp, headersMs: event.headersMs })
      if(active&&onHeaders){try{onHeaders({...event},response.headers)}catch{}}
      if (!active || !response.body) { event.totalMs = elapsed(); publish(); return response }
      const reader = response.body.getReader()
      const observeText = route === 'inference' && event.contentType === 'text/event-stream' ? textObserver(event, elapsed) : null
      const body = new ReadableStream({
        async pull(controller) {
          try {
            const chunk = await reader.read()
            if (chunk.done) { event.totalMs = elapsed(); event.outcome = 'consumed'; publish(); controller.close(); return }
            if (event.firstByteMs === undefined) event.firstByteMs = elapsed()
            if (observeText) observeText(chunk.value)
            controller.enqueue(chunk.value)
          } catch (error) { event.totalMs = elapsed(); event.outcome = 'body-error'; event.transportCode = transportCode(error); publish(); controller.error(error) }
        },
        cancel(reason) { event.totalMs = elapsed(); event.outcome = 'cancelled'; publish(); return reader.cancel(reason) },
      }, { highWaterMark: 0 })
      const observed = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
      responses.set(observed, responses.get(response))
      return observed
    } catch (error) {
      event.totalMs = elapsed(); event.outcome = 'headers-error'; event.transportCode = transportCode(error)
      if (error && typeof error === 'object') failures.set(error, { requestId: event.requestId, route, startedAt: event.timestamp, totalMs: event.totalMs })
      publish(); throw error
    }
  }
}
module.exports = { diagnosticFetch, oauthFailure }
