// Product-owned, per-agent model presentation. Never changes tool execution,
// permission guards, MCP registration, or the underlying parameter schemas.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { automationToolPresentationHints } from './index.js'

export const name = 'crawshrimp-context-tools'
export const inject = ['tools', 'systemPrompt']
export const Config = z.object({ mode: z.union([z.const('compact'), z.const('domains')]).default('compact') })
export const DOMAIN_TOOL = 'enable_tools'
const MARKER = 'crawshrimp-tool-domains-v1'
export const DOMAINS = Object.freeze({
  browser: { description: '网页观察、导航、筛选、翻页与核对（抓虾CDP）', guide: 'workflow' },
  office: { description: 'Word/PPT/Excel生成、渲染、逐页审阅与交付', guide: 'office' },
  automation: { description: '定时/周期任务创建、管理、自然触发验收', guide: 'automation' },
  media: { description: '图片/参考图修改、视频生成与产物查询', guide: 'media' },
  tasks: { description: '抓虾脚本搜索、执行、编写、校验、固化', guide: 'workflow' },
  data: { description: '任务产物、表格分析与导出', guide: 'data' },
  repo: { description: '代码仓库安装、更新与生成技能', guide: 'workflow' },
  delegation: { description: '复杂任务的子代理、工作流、目标与任务清单', guide: null },
})
const nativeDomains = new Map([
  ...['subagent', 'subagent_fork', 'subagent_codex', 'subagent_claude_code', 'list_agents', 'interrupt_agent', 'send_message', 'workflow', 'ralph', 'create_goal', 'get_goal', 'update_goal', 'todo_write'].map(n => [n, 'delegation']),
  ...['schedule_create', 'schedule_delete', 'schedule_list'].map(n => [n, 'automation']),
])
export function toolDomain(name) {
  if (nativeDomains.has(name)) return nativeDomains.get(name)
  if (!name.startsWith('mcp__crawshrimp__')) return undefined // unknown extensions remain discoverable
  const tool = name.slice('mcp__crawshrimp__'.length)
  if (tool.startsWith('browser_')) return 'browser'
  if (tool.startsWith('office_')) return 'office'
  if (tool.startsWith('automation_')) return 'automation'
  if (/^(image|video)_/.test(tool)) return 'media'
  if (/^(task|tasks|script)_/.test(tool)) return 'tasks'
  if (/^(data|artifacts)_/.test(tool)) return 'data'
  if (tool.startsWith('repo_')) return 'repo'
  return undefined // files, attachments and skills stay resident
}
const SHORT_DESCRIPTIONS = Object.freeze({
  mcp__crawshrimp__image_generate: '生成1–4张图片或参考图改图。先image_models确认完整模型ID，并读crawshrimp-product-guide/references/media.md。reference_image_paths用真实只读路径，reference_attachment_ids仅当前抓虾附件ID（非原生sha256）；共≤10张PNG/JPEG/WebP、每张≤20MB。纯文生图省略参考图，未指定key_tier自动选择已配置档位。调用等待完成；状态未知先核对，不重复提交。按delivery交付，requires_file_return=false不重复回传。',
  mcp__crawshrimp__skill_list: '发现内置技能与CLI，返回root/absolute_path、SKILL.md、cli_root、入口、运行时、ready状态；包括网页、办公、电商与钉钉。按需skill_read，不全量读取。',
  mcp__crawshrimp__automation_wait_next: '等待自然scheduled触发，after_run_uid传上次游标；最长60秒，不创建运行。超时保留游标；出现后automation_wait_run。源会话忙时回执暂存，验收结束暂停计划并结束回复后送达，勿轮询自己的回执。',
})
export function projectTools(tools, active, mode = 'compact') {
  return tools.filter(tool => mode !== 'domains' || !toolDomain(tool.name) || active.has(toolDomain(tool.name)))
    .map(tool => SHORT_DESCRIPTIONS[tool.name] ? { ...tool, description: SHORT_DESCRIPTIONS[tool.name] } : tool)
}

function restoreDomains(session) {
  const active = new Set()
  // Use logged headers as the authority, not text from the user or tool results.
  // A legacy/full session keeps its already advertised domains on resume.
  for (const tool of session?.requestHeader?.()?.tools || []) {
    const domain = toolDomain(tool.name)
    if (domain) active.add(domain)
  }
  // A successful enable_tools may be durable just before its next header.
  const calls = new Set()
  for (const row of session?.snapshotEvents?.() || []) {
    if (row.type === 'tool/call' && row.data.name === DOMAIN_TOOL) calls.add(row.data.callId)
    if (row.type !== 'tool/result' || row.data.error) continue
    for (const block of row.data.message?.content || []) {
      if (block.type !== 'tool-result' || block.isError || !calls.has(block.toolCallId)) continue
      for (const item of block.content || []) {
        if (item.type !== 'text') continue
        try {
          const value = JSON.parse(item.text)
          if (value.kind === MARKER && Array.isArray(value.active)) {
            for (const domain of value.active) if (Object.hasOwn(DOMAINS, domain)) active.add(domain)
          }
        } catch { /* Not a domain activation record. */ }
      }
    }
  }
  return active
}

export function createDomainState() {
  const sessions = new WeakMap()
  return agent => {
    if (!agent?.session) throw new Error('工具发现需要当前会话')
    if (!sessions.has(agent.session)) sessions.set(agent.session, restoreDomains(agent.session))
    return sessions.get(agent.session)
  }
}

export function apply(ctx, config = {}) {
  const mode = config.mode || 'compact'
  const stateFor = createDomainState()
  const root = process.env.CRAWSHRIMP_SKILL_ROOT || fileURLToPath(new URL('../../skills/', import.meta.url))
  const guidance = new Map()
  async function readGuidance(domain) {
    const file = DOMAINS[domain].guide
    if (!file) return ''
    if (!guidance.has(file)) {
      const text = await readFile(join(root, 'crawshrimp-product-guide', 'references', `${file}.md`), 'utf8')
      if (Buffer.byteLength(text) > 65536) throw new Error('领域指引超过大小限制')
      guidance.set(file, text)
    }
    return guidance.get(file)
  }
  ctx.tools.register(defineTool({
    name: DOMAIN_TOOL,
    description: '按领域发现并加载工具：browser网页、office办公、automation定时、media图片视频、tasks脚本任务、data数据、repo仓库、delegation复杂协作。domains可一次传多个；空数组仅查看。加载在本会话内持续有效，不新增权限；仅返回实际可用工具。',
    parameters: { domains: { type: 'array', items: { type: 'string', enum: Object.keys(DOMAINS) }, required: true } },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute({ domains }, exec) {
      exec.signal?.throwIfAborted()
      const active = stateFor(exec.agent)
      const requested = [...new Set(domains)]
      if (requested.some(d => !Object.hasOwn(DOMAINS, d))) throw new Error('未知工具领域')
      const schemas = ctx.tools.schemas(exec.agent)
      const available = requested.filter(d => schemas.some(t => toolDomain(t.name) === d))
      // Browser, scripts and repo share one guide: include it once per call.
      const guideDomains = [...new Map(available.filter(d => DOMAINS[d].guide).map(d => [DOMAINS[d].guide, d])).entries()]
      const instructions = Object.fromEntries(await Promise.all(guideDomains.map(async ([file, d]) => [file, await readGuidance(d)])))
      exec.signal?.throwIfAborted()
      for (const domain of available) active.add(domain)
      return {
        kind: MARKER, active: [...active].sort(),
        domains: Object.fromEntries(Object.entries(DOMAINS).map(([d, info]) => [d, info.description])),
        unavailable: requested.filter(d => !available.includes(d)),
        tools: schemas.filter(t => available.includes(toolDomain(t.name))).map(t => t.name).sort(),
        instructions,
        note: '下一次模型请求可调用以上工具，权限和审批保持原样。不得用原生schedule工具代替抓虾automation工具。',
      }
    },
    presentCall: () => ({ card: 'generic', title: '加载任务所需工具', kind: 'read' }),
  }))
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    if (!context.agent) return assembled
    const active = stateFor(context.agent)
    // Automations must not need an extra native discovery call outside their
    // immutable allowlist. These hints affect visibility only, never the guard.
    for (const name of automationToolPresentationHints(context.agent.id)) {
      const domain = toolDomain(name.startsWith('mcp__') ? name : `mcp__crawshrimp__${name}`) || toolDomain(name)
      if (domain) active.add(domain)
    }
    return { ...assembled, tools: projectTools(assembled.tools, active, mode) }
  })
}
