export function modelAvailability(model) {
  return model?.available === true ? 'available' : model?.available === false ? 'unavailable' : 'unknown'
}
export function modelAvailabilityLabel(model) {
  return { available: '当前可用', unavailable: '暂不可用', unknown: '待确认' }[modelAvailability(model)]
}
export function catalogSummary(models) {
  if (!Array.isArray(models) || !models.length) return '查看最新模型目录与使用权限'
  const known = models.filter(model => typeof model.available === 'boolean')
  if (!known.length) return '模型目录已读取，使用权限待确认'
  return `当前可用 ${known.filter(model => model.available).length} / ${models.length} 个官方模型`
}
