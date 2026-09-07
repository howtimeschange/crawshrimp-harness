'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeAgentApiRequest } = require('./agentApiBridge')

test('normalizes the local agent API methods and relative paths accepted by the main-process bridge', () => {
  assert.deepEqual(normalizeAgentApiRequest('patch', '/agent/sessions/current/model'), {
    method: 'PATCH',
    path: '/agent/sessions/current/model',
  })
})

test('rejects non-local or unsupported requests before they can reach the backend bridge', () => {
  assert.throws(() => normalizeAgentApiRequest('CONNECT', '/agent/runtime'), /不支持/)
  assert.throws(() => normalizeAgentApiRequest('GET', '/settings'), /智能体/)
  assert.throws(() => normalizeAgentApiRequest('GET', '//outside.example/agent/runtime'), /单个/)
  assert.throws(() => normalizeAgentApiRequest('POST', 'https://outside.example/agent/runtime'), /单个/)
  assert.throws(() => normalizeAgentApiRequest('GET', '/agent\\runtime'), /单个/)
})
