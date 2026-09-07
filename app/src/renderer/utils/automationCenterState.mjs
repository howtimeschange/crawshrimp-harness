function splitToolset(value) {
  return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))]
}

function numberOr(value, fallback) {
  return value === null || value === undefined || value === '' ? fallback : Number(value)
}

export function scheduleValueForInput(value) {
  const text = String(value || '')
  // datetime-local cannot carry an offset, but can and must carry seconds.
  return text ? text.replace(/([+-]\d\d:\d\d|Z)$/u, '').slice(0, 19) : ''
}

export function formFromAutomation(item = {}, defaults = {}) {
  const schedule = item?.schedule || {}
  const loop = item?.loop_policy || {}
  const policy = item?.execution_policy || {}
  return {
    ...defaults,
    title: item.title || '',
    objective_prompt: item.objective_prompt || '',
    automation_kind: item.automation_kind || 'loop',
    context_mode: item.context_mode || 'isolated',
    source_session_id: item.source_session_id || '',
    timezone: schedule.timezone || 'Asia/Shanghai',
    schedule_kind: schedule.kind || 'every',
    schedule_value: schedule.kind === 'at'
      ? scheduleValueForInput(schedule.value || schedule.at || schedule.run_at)
      : (schedule.value || schedule.cron || ''),
    schedule_interval_seconds: numberOr(schedule.interval_seconds ?? schedule.seconds, 3600),
    cycle_interval_seconds: numberOr(loop.cycle_interval_seconds ?? loop.interval_seconds, 1800),
    max_cycles: numberOr(loop.max_cycles, 0),
    failure_threshold: numberOr(loop.failure_threshold, 3),
    toolset_text: Array.isArray(policy.toolset) ? policy.toolset.join(', ') : '',
    allowed_risks_text: Array.isArray(policy.allowed_risks) ? policy.allowed_risks.join(', ') : '',
    timeout_seconds: numberOr(policy.timeout_seconds, 300),
    max_retries: numberOr(policy.max_retries, 1),
    inherited_wait_seconds: numberOr(policy.inherited_wait_seconds, 300),
    enabled: Boolean(item.enabled),
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
    context_mode: form.context_mode,
    schedule,
    loop_policy: {
      cycle_interval_seconds: Number(form.cycle_interval_seconds || 0),
      max_cycles: Number(form.max_cycles || 0),
      failure_threshold: Number(form.failure_threshold || 0),
    },
    execution_policy: {
      toolset: splitToolset(form.toolset_text),
      allowed_risks: splitToolset(form.allowed_risks_text),
      timeout_seconds: Number(form.timeout_seconds || 0),
      max_retries: numberOr(form.max_retries, 0),
      ...(form.context_mode === 'inherited'
        ? { inherited_wait_seconds: Number(form.inherited_wait_seconds || 0) }
        : {}),
    },
    enabled: Boolean(form.enabled),
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
      const response = await api.getAutomation(uid)
      if (this.selectedUid !== uid || sequence !== selectionSequence) return
      this.selectedAutomation = response?.automation || response || null
      await this.loadRuns(uid, sequence)
    },
    async runNow(automation) {
      const uid = String(automation?.automation_uid || '')
      await api.runAutomationNow(uid, `desktop:test:${uid}`)
      await api.listAutomations()
      if (this.selectedUid === uid) await this.loadRuns(uid, selectionSequence)
    },
  }
}
