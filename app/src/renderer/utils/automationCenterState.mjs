function splitToolset(value) {
  return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))]
}

function numberOr(value, fallback) {
  return value === null || value === undefined || value === '' ? fallback : Number(value)
}

export const automationPermissionFlags = [
  ['allow_browser', '浏览器操作'],
  ['allow_filesystem', '读取和保存文件'],
  ['allow_network', '联网访问'],
  ['allow_external_messages', '向约定渠道发送消息'],
  ['allow_script_publish', '发布脚本'],
]

const permissionPolicyFields = new Set([
  'toolset', 'allowed_tools', 'allowed_capabilities',
  'native_toolset', 'allowed_risks', 'risk',
  'allow_browser', 'allow_filesystem', 'allow_network',
  'allow_external_messages', 'allow_script_publish',
  'browser_tab_id', 'browser_url',
])

const nonPermissionSessionPolicyFields = new Set([
  'permission_mode',
  'timeout_seconds', 'max_retries', 'retry_backoff_seconds', 'inherited_wait_seconds',
  'verification_schema',
])

function canonicalPermissionMode(value) {
  const mode = String(value || '').trim().toLowerCase()
  return ['advanced', 'legacy'].includes(mode) ? 'scoped' : mode
}

export function inferAutomationPermissionMode(policy, { automationKind = 'scheduled', hasProgram = false } = {}) {
  const source = policy && typeof policy === 'object' && !Array.isArray(policy) ? policy : {}
  const nested = source.execution_policy && typeof source.execution_policy === 'object' && !Array.isArray(source.execution_policy)
    ? source.execution_policy
    : null
  const explicit = source.permission_mode ?? nested?.permission_mode
  if (explicit !== undefined && String(explicit).trim()) {
    return canonicalPermissionMode(explicit)
  }
  if (String(automationKind || '').trim().toLowerCase() !== 'scheduled' || hasProgram) return 'scoped'
  const layers = nested ? [source, nested] : [source]
  for (const layer of layers) {
    for (const key of Object.keys(layer)) {
      if (key === 'execution_policy') continue
      if (permissionPolicyFields.has(key)) return 'scoped'
      if (!nonPermissionSessionPolicyFields.has(key)) return 'scoped'
    }
  }
  return 'session'
}

// A selected scope includes the preparation and recovery tools needed to
// carry it out. Saving the editor persists this agreement for future runs.
export function addAutomationPermissionScope(form, scope) {
  const presets = {
    browser: {
      tools: ['browser_navigate', 'browser_observe', 'browser_eval', 'browser_act', 'browser_verify'],
      risks: ['read_only', 'local_write'],
      flags: ['allow_browser', 'allow_network'],
    },
    local: {
      tools: ['fs_read', 'fs_list', 'fs_write', 'skill_list', 'skill_read'],
      native: ['read', 'read_image', 'write', 'edit', 'str_replace_editor', 'glob', 'grep', 'skill'],
      risks: ['read_only', 'local_write'],
      flags: ['allow_filesystem'],
    },
    commands: {
      tools: ['fs_exec'],
      native: ['bash', 'pwsh'],
      risks: ['local_write', 'external_write'],
      flags: automationPermissionFlags.map(([flag]) => flag),
    },
    network: {
      native: ['web_search', 'web_fetch'],
      risks: ['read_only'],
      flags: ['allow_network'],
    },
  }
  const preset = presets[scope]
  if (!preset) return form
  const merge = (current, additions) => [...new Set([...splitToolset(current), ...additions])].join(', ')
  return {
    ...form,
    toolset_text: merge(form.toolset_text, [...(preset.tools || []), 'automation_record_verification']),
    native_toolset_text: merge(form.native_toolset_text, preset.native || []),
    allowed_risks_text: merge(form.allowed_risks_text, preset.risks),
    ...Object.fromEntries(preset.flags.map(flag => [flag, true])),
  }
}

export function scheduleValueForInput(value, timezone = 'Asia/Shanghai') {
  const text = String(value || '')
  if (!text) return ''
  // Offset-free values already name a wall clock in the schedule timezone.
  // Only absolute instants need conversion before entering datetime-local.
  if (!/(?:Z|[+-]\d\d:?\d\d)$/iu.test(text)) return text.slice(0, 19)
  const instant = new Date(text)
  if (Number.isNaN(instant.getTime())) return text.replace(/([+-]\d\d:?\d\d|Z)$/iu, '').slice(0, 19)
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: String(timezone || 'Asia/Shanghai'),
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`
  } catch {
    return text.replace(/([+-]\d\d:?\d\d|Z)$/iu, '').slice(0, 19)
  }
}

export function formFromAutomation(item = {}, defaults = {}, { copy = false } = {}) {
  const schedule = item?.schedule || {}
  const loop = item?.loop_policy || {}
  const policy = item?.execution_policy || {}
  const hasProgram = item?.program !== undefined && item?.program !== null
    || Boolean(String(item?.active_program_version_uid || '').trim())
  return {
    ...defaults,
    title: item.title || '',
    objective_prompt: item.objective_prompt || '',
    automation_kind: item.automation_kind || 'loop',
    context_mode: item.context_mode || 'isolated',
    permission_mode: inferAutomationPermissionMode(policy, {
      automationKind: item.automation_kind || 'loop',
      hasProgram,
    }),
    source_session_id: item.source_session_id || '',
    timezone: schedule.timezone || 'Asia/Shanghai',
    schedule_kind: schedule.kind || 'every',
    schedule_value: schedule.kind === 'at'
      ? scheduleValueForInput(schedule.value || schedule.at || schedule.run_at, schedule.timezone)
      : (schedule.value || schedule.cron || ''),
    schedule_interval_seconds: numberOr(schedule.interval_seconds ?? schedule.seconds, 3600),
    cycle_interval_seconds: numberOr(loop.cycle_interval_seconds ?? loop.interval_seconds, 1800),
    max_cycles: numberOr(loop.max_cycles, 0),
    failure_threshold: numberOr(loop.failure_threshold, 3),
    toolset_text: Array.isArray(policy.toolset) ? policy.toolset.join(', ') : '',
    native_toolset_text: Array.isArray(policy.native_toolset) ? policy.native_toolset.join(', ') : '',
    browser_url: policy.browser_url || '',
    ...Object.fromEntries(automationPermissionFlags.map(([flag]) => [flag, policy[flag] !== false])),
    allowed_risks_text: Array.isArray(policy.allowed_risks) ? policy.allowed_risks.join(', ') : '',
    timeout_seconds: numberOr(policy.timeout_seconds, 300),
    max_retries: numberOr(policy.max_retries, 1),
    inherited_wait_seconds: numberOr(policy.inherited_wait_seconds, 300),
    enabled: copy ? false : Boolean(item.enabled),
    program_text: item.program && Object.keys(item.program).length ? JSON.stringify(item.program, null, 2) : '',
    facts_text: JSON.stringify({}, null, 2),
    checkpoint_text: JSON.stringify(item.checkpoint || {}, null, 2),
  }
}

export function payloadFromAutomationForm(form, { editing = false } = {}) {
  const schedule = { timezone: String(form.timezone || '').trim() || 'Asia/Shanghai' }
  if (form.automation_kind === 'scheduled') {
    schedule.kind = form.schedule_kind
    if (schedule.kind === 'every') schedule.interval_seconds = Number(form.schedule_interval_seconds || 0)
    else schedule.value = form.schedule_value
  }
  const payload = {
    title: String(form.title || '').trim(),
    objective_prompt: String(form.objective_prompt || '').trim(),
    automation_kind: form.automation_kind,
    ...(!editing ? { context_mode: form.context_mode } : {}),
    schedule,
    loop_policy: {
      cycle_interval_seconds: Number(form.cycle_interval_seconds || 0),
      max_cycles: Number(form.max_cycles || 0),
      failure_threshold: Number(form.failure_threshold || 0),
    },
    execution_policy: {
      permission_mode: form.permission_mode || 'scoped',
      toolset: splitToolset(form.toolset_text),
      native_toolset: splitToolset(form.native_toolset_text),
      browser_url: String(form.browser_url || '').trim(),
      allowed_risks: splitToolset(form.allowed_risks_text),
      ...Object.fromEntries(automationPermissionFlags
        .filter(([flag]) => typeof form[flag] === 'boolean')
        .map(([flag]) => [flag, form[flag]])),
      timeout_seconds: Number(form.timeout_seconds || 0),
      max_retries: numberOr(form.max_retries, 0),
      ...(form.context_mode === 'inherited'
        ? { inherited_wait_seconds: Number(form.inherited_wait_seconds || 0) }
        : {}),
    },
    enabled: Boolean(form.enabled),
  }
  if (form.permission_mode === 'session') {
    payload.execution_policy = {
      permission_mode: 'session',
      timeout_seconds: Number(form.timeout_seconds || 300),
      max_retries: numberOr(form.max_retries, 0),
      ...(form.context_mode === 'inherited'
        ? { inherited_wait_seconds: Number(form.inherited_wait_seconds || 300) }
        : {}),
    }
  }
  if (!editing && form.context_mode === 'inherited') {
    payload.source_session_id = String(form.source_session_id || '').trim()
  }
  return payload
}

export function createAutomationViewState(api) {
  let selectionSequence = 0
  let runsSequence = 0
  const runsByAutomation = new Map()
  return {
    selectedUid: '',
    selectedAutomation: null,
    get runsForSelected() { return runsByAutomation.get(this.selectedUid) || [] },
    clear() {
      selectionSequence += 1
      runsSequence += 1
      this.selectedUid = ''
      this.selectedAutomation = null
    },
    async loadRuns(uid, sequence = selectionSequence) {
      const request = ++runsSequence
      const response = await api.listAutomationRuns(uid, 20)
      const items = Array.isArray(response?.items) ? response.items : []
      if (this.selectedUid === uid && sequence === selectionSequence && request === runsSequence) {
        runsByAutomation.set(uid, items)
      }
      return items
    },
    async select(uid) {
      const sequence = ++selectionSequence
      this.selectedUid = uid
      this.selectedAutomation = null
      const response = await api.getAutomation(uid)
      if (this.selectedUid !== uid || sequence !== selectionSequence) return
      this.selectedAutomation = response?.automation || response || null
      await this.loadRuns(uid, sequence)
    },
    async runNow(automation, requestUid = '') {
      const uid = String(automation?.automation_uid || '')
      const requestId = String(requestUid || `desktop:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`)
      await api.runAutomationNow(uid, requestId)
      const definitions = await api.listAutomations()
      if (this.selectedUid === uid) await this.loadRuns(uid, selectionSequence)
      return definitions
    },
  }
}
