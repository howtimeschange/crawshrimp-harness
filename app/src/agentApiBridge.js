'use strict'

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

function normalizeAgentApiRequest(method, requestPath) {
  const normalizedMethod = String(method || '').trim().toUpperCase()
  if (!ALLOWED_METHODS.has(normalizedMethod)) {
    throw new Error('不支持的本地智能体请求方法')
  }

  const normalizedPath = String(requestPath || '').trim()
  if (!normalizedPath.startsWith('/') || normalizedPath.startsWith('//') || normalizedPath.includes('\\')) {
    throw new Error('本地智能体路径必须以单个 / 开头')
  }
  if (normalizedPath !== '/agent' && !normalizedPath.startsWith('/agent/')) {
    throw new Error('本地桥接仅允许智能体 API 路径')
  }

  return { method: normalizedMethod, path: normalizedPath }
}

module.exports = { normalizeAgentApiRequest }
