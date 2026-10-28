const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const timestamp = value => typeof value === 'number' && value > 0 && Number.isFinite(new Date(value).getTime()) ? value : null
const moneyFormat = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dateFormat = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const money = value => !amount(value) ? '—' : value > 0 && value < 0.01 ? '不足 ¥0.01' : moneyFormat.format(value)

// /account/allowance is already denominated in CNY. Legacy key quota and
// /account/usage totals cannot establish either wallet pool.
export function validateAllowance(value) {
  if (value?.currency !== 'CNY' || !amount(value.available) || !['monthly', 'permanent'].every(key =>
    value[key] && ['total', 'remaining', 'used', 'reserved'].every(field => amount(value[key][field]))
  )) throw new Error('额度数据暂不可用，请稍后刷新')
  return value
}

export function validateSubscription(value) {
  const nested = value && Object.hasOwn(value, 'membership')
  const member = nested ? value.membership : value
  if (typeof member?.active !== 'boolean') throw new Error('订阅状态暂不可用')
  if (nested && (!['apple', 'benefit', 'experience', 'legacy', 'none'].includes(member.source) || !['free', 'plus', 'pro'].includes(member.plan) || typeof member.authoritative !== 'boolean' || !Object.hasOwn(member, 'expiresAt') || (member.expiresAt !== null && timestamp(member.expiresAt) === null) || (member.active && (member.plan === 'free' || ['legacy', 'none'].includes(member.source))))) throw new Error('会员来源暂不可用')
  return { active: member.active, plan: member.plan, expiresAt: timestamp(member.expiresAt), source: nested ? member.source : 'apple-context', authoritative: nested && member.authoritative }
}

function poolView(pool) {
  return {
    remaining: money(pool?.remaining), total: money(pool?.total), used: money(pool?.used),
    percent: pool ? pool.total > 0 ? Math.min(100, Math.max(0, pool.remaining / pool.total * 100)) : 0 : null,
    hasTotal: Boolean(pool?.total > 0),
  }
}

export function usageView(value, { subscription = null, plan = '', now = Date.now() } = {}) {
  let wallet = null
  try { wallet = validateAllowance(value) } catch { /* Unknown is never a zero balance. */ }
  const monthly = poolView(wallet?.monthly), permanent = poolView(wallet?.permanent)
  const independentMembership = ['benefit', 'experience', 'legacy'].includes(subscription?.source)
  const fundedPeriod = Boolean(wallet?.monthly.total > 0 && timestamp(wallet?.monthly.resetsAt) > now)
  const recordedEnd = (independentMembership ? null : timestamp(subscription?.expiresAt)) ?? timestamp(wallet?.monthly.resetsAt)
  const end = subscription?.active === false && !wallet?.monthly.total ? null : recordedEnd
  const expired = end !== null && end <= now
  const inactive = (!independentMembership && subscription?.active === false && !(subscription.source === 'apple-context' && fundedPeriod)) || expired
  const hasPeriod = !inactive && ((!independentMembership && subscription?.active === true) || Boolean(wallet?.monthly.total > 0))
  const historical = Boolean(wallet?.monthly.total > 0 && inactive)
  const effectivePlan = subscription?.authoritative ? subscription.active ? subscription.plan : 'free' : subscription?.active ? subscription.plan || plan : plan
  const tier = { pro: 'Pro', plus: 'Plus' }[effectivePlan]
  const confirmedApple = subscription?.active === true && !independentMembership
  const membership = !subscription ? '会员状态待确认' : subscription.source === 'experience' && subscription.active ? `${tier ? tier + ' ' : ''}体验会员` : confirmedApple && !expired ? `${tier ? tier + ' ' : ''}月订阅会员` : tier ? `${tier} 会员权益` : effectivePlan === 'free' ? '免费账户' : '会员状态待确认'
  const noPeriod = inactive || independentMembership || effectivePlan === 'free'
  const expiryText = end !== null ? dateFormat.format(end) : hasPeriod ? '到期日期暂不可用' : noPeriod ? '暂无有效月订阅' : '有效账期待确认'
  let detail = '额度暂不可用，请稍后刷新。'
  if (wallet) {
    if (historical) detail = '上期订阅额度记录，请刷新确认当前账期。'
    else if (hasPeriod) detail = '到期后本期剩余额度不结转，续订成功后更新。'
    else if (noPeriod) detail = tier ? '当前没有订阅额度，可使用永久余额。' : '暂无订阅额度，订阅 Plus / Pro 后按月获得。'
    else detail = '当前会员权益不代表月订阅账期，请刷新确认。'
  }
  const asOf = typeof wallet?.asOf === 'string' && Number.isFinite(Date.parse(wallet.asOf)) ? new Date(wallet.asOf) : null
  return {
    available: Boolean(wallet), totalAvailable: money(wallet?.available),
    monthly: { ...monthly, detail, historical, hasPeriod, expired, expiryText, expiryPrefix: expired ? '已于' : inactive ? '记录截止' : '本期到期', status: expired ? '月订阅已到期' : inactive || plan === 'free' ? '暂无有效月订阅' : '有效账期待确认', expiresISO: end ? new Date(end).toISOString() : null },
    permanent, membership, plan: effectivePlan,
    membershipStatus: !subscription ? '请刷新确认会员状态' : independentMembership && subscription?.active
      ? timestamp(subscription.expiresAt) ? '会员有效期至 ' + dateFormat.format(subscription.expiresAt) : '会员到期日期暂不可用'
      : !confirmedApple && hasPeriod ? '额度有效期以下方账期为准' : !hasPeriod ? expired ? '月订阅已到期' : noPeriod ? '暂无有效月订阅' : '有效账期待确认' : '',
    membershipNote: wallet && tier && noPeriod && !wallet.monthly.total
      ? `当前账号享有 ${tier} 会员权益。当前没有订阅额度，可用余额见下方永久额度。`
      : '',
    reserved: money(wallet ? wallet.monthly.reserved + wallet.permanent.reserved : null),
    hasReserved: Boolean(wallet && wallet.monthly.reserved + wallet.permanent.reserved > 0),
    asOf: asOf ? dateFormat.format(asOf) : null,
  }
}
