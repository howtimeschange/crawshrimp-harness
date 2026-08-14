// 抓虾产品桥(host 插件):把产品层(FastAPI/MCP 网关)的敏感操作审批
// 接入 DSH 原生审批交互 —— ctx.approval.request 触发 approval/asked 会话事件,
// apiproxy 建立 pending 并经原生 UI 呈现审批卡,用户决策后回传结果。
// FastAPI 侧经 HTTP 调用本插件的 /api/crawshrimp/approval/request。
export const name = 'crawshrimp-product-bridge'

export const inject = ['webServer', 'approval', 'agents', 'tools']

const MCP_TOOL_PREFIX = 'mcp__crawshrimp__'

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

function findLiveAgent(ctx, sessionId) {
  const agents = ctx.agents
  if (!agents) return undefined
  for (const agent of agents.roots() || []) {
    if (String(agent?.session?.id) === String(sessionId)) return agent
  }
  return undefined
}

export function apply(ctx) {
  // DSH 的 MCP transport 是 runtime 级单连接，请求上没有 session header。
  // tools/execute 的 exec.agent.id 是可靠会话身份：先租用后端对应 run 上下文，
  // 再执行真实 MCP HTTP 调用，finally 释放。后端 lease 同时提供跨会话互斥。
  ctx.on('tools/execute', async (exec, next) => {
    if (!String(exec?.name || '').startsWith(MCP_TOOL_PREFIX)) return next()
    const runtimeSessionId = String(exec.agent?.id || '')
    if (!runtimeSessionId) throw new Error('Crawshrimp MCP tool missing agent session')
    const lease = await postMcpContext('acquire', {
      runtime_session_id: runtimeSessionId,
      call_id: String(exec.callId || ''),
    })
    try {
      return await next()
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
