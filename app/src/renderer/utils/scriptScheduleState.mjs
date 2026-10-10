export function scheduleScriptOptions(tasks) {
  return (Array.isArray(tasks) ? tasks : []).filter(task => task.adapter_id && task.task_id).map(task => ({
    key: JSON.stringify([task.adapter_id, task.task_id]),
    name: task.task_name || task.name || task.task_id,
    label: `${task.task_name || task.name || task.task_id} · ${task.adapter_name || task.adapter_id}`,
    defaults: Object.fromEntries((task.params || []).filter(param => param.default != null).map(param => [param.id, param.default])),
  }))
}

export function scriptSchedulePayload(form) {
  let ids, params
  try { ids = JSON.parse(form.task_key || '') } catch { throw new Error('请选择已有脚本') }
  if (!Array.isArray(ids) || ids.length !== 2 || ids.some(id => typeof id !== 'string' || !id.trim())) throw new Error('请选择已有脚本')
  try { params = JSON.parse(form.params_text || '{}') } catch { throw new Error('运行参数不是有效 JSON') }
  if (!params || Array.isArray(params) || typeof params !== 'object') throw new Error('运行参数必须是 JSON 对象')
  return {
    adapter_id: ids[0], task_id: ids[1], title: form.title,
    frequency: form.frequency, time_of_day: form.time_of_day,
    weekday: form.frequency === 'weekly' ? Number(form.weekday || 1) : null,
    params, sync_to_cloud: Array.isArray(params.sync_to_cloud) ? params.sync_to_cloud.includes('enabled') : Boolean(params.sync_to_cloud), notify_channel: form.notify_channel || 'none',
    notify_template: form.notify_template || '{{schedule_title}}：{{status}}\n{{error}}',
    enabled: Boolean(form.enabled),
  }
}
