import test from 'node:test'
import assert from 'node:assert/strict'
import { usageView, validateAllowance, validateSubscription } from './managedUsage.mjs'
const now = Date.parse('2026-10-24T12:00:00Z')
const end = Date.parse('2026-11-01T12:00:00Z')
const pool = (total, remaining, extra = {}) => ({ total, remaining, used: total - remaining, reserved: 0, resetsAt: null, ...extra })
const wallet = (monthly = pool(120, 90, { resetsAt: end }), permanent = pool(60, 55)) => ({ currency: 'CNY', available: monthly.remaining + permanent.remaining, monthly, permanent, asOf: '2026-10-24T12:00:00Z' })

test('uses CNY pools directly with independent remaining ratios and actual billing date', () => {
  const view = usageView(wallet(), { plan: 'plus', subscription: { active: true, plan: 'plus', expiresAt: end }, now })
  assert.equal(view.totalAvailable, '¥145.00')
  assert.equal(view.monthly.remaining, '¥90.00')
  assert.equal(view.monthly.total, '¥120.00')
  assert.equal(view.monthly.percent, 75)
  assert.equal(view.permanent.remaining, '¥55.00')
  assert.equal(view.permanent.percent, 55 / 60 * 100)
  assert.equal(view.monthly.expiresISO, new Date(end).toISOString())
  assert.equal(view.monthly.hasPeriod, true)
  assert.equal(view.membership, 'Plus 月订阅会员')
  assert.equal(view.membershipNote, '')
})
test('legacy quota and unlimited keys cannot masquerade as either wallet pool', () => {
  for (const unlimited_quota of [true, false]) {
    const view = usageView({ data: { unlimited_quota, total_available: 500000 }, allowance: { scope: 'account', remaining: 500000 }, billing: { quotaPerUnit: 500000, exchangeRate: 7.3 } })
    assert.equal(view.available, false); assert.equal(view.totalAvailable, '—')
    assert.equal(view.monthly.percent, null); assert.equal(view.permanent.remaining, '—')
  }
})
test('Free and manual Pro keep permanent balance without inventing a monthly period', () => {
  for (const plan of ['free', 'pro']) {
    const view = usageView(wallet(pool(0, 0), pool(360, 357.93)), { plan, subscription: { active: false, expiresAt: end }, now })
    assert.equal(view.totalAvailable, '¥357.93')
    assert.equal(view.monthly.remaining, '¥0.00'); assert.equal(view.monthly.percent, 0)
    assert.equal(view.monthly.expiresISO, null); assert.equal(view.monthly.expiryText, '暂无有效月订阅')
    assert.equal(view.permanent.total, '¥360.00')
    assert.equal(view.membership, plan === 'pro' ? 'Pro 会员权益' : '免费账户')
    assert.equal(Boolean(view.membershipNote), plan === 'pro')
    if (plan === 'pro') assert.match(view.membershipNote, /当前没有订阅额度/)
  }
})
test('missing subscription data stays unknown; wallet period is a supported fallback', () => {
  const empty = usageView(wallet(pool(0, 0)), { plan: 'pro', now })
  assert.equal(empty.monthly.expiryText, '有效账期待确认')
  assert.equal(empty.membershipNote, '')
  const fallback = usageView(wallet(), { plan: 'plus', now })
  assert.equal(fallback.monthly.expiresISO, new Date(end).toISOString())
  assert.equal(fallback.monthly.hasPeriod, true)
  const missingDate = usageView(wallet(pool(120, 90)), { plan: 'plus', now })
  assert.equal(missingDate.monthly.expiryText, '到期日期暂不可用')
  assert.equal(missingDate.monthly.expiresISO, null)
})
test('expired periods and explicitly inactive subscriptions label previous records', () => {
  const expired = usageView(wallet(), { subscription: { active: true, expiresAt: now - 1 }, now })
  assert.equal(expired.monthly.expired, true)
  assert.equal(expired.monthly.hasPeriod, false)
  assert.equal(expired.monthly.historical, true)
  assert.match(expired.monthly.detail, /上期/)
  const inactive = usageView(wallet(), { subscription: { active: false }, now })
  assert.equal(inactive.monthly.historical, true); assert.equal(inactive.monthly.hasPeriod, false)
  assert.equal(inactive.monthly.expiryPrefix, '记录截止')
  const boundary = usageView(wallet(), { subscription: { active: true, expiresAt: now }, now })
  assert.equal(boundary.monthly.expired, true)
})
test('exhausted, tiny, reserved and zero-total balances keep distinct meanings', () => {
  const exhausted = usageView(wallet(pool(120, 0), pool(0, 0)), { now })
  assert.equal(exhausted.totalAvailable, '¥0.00'); assert.equal(exhausted.monthly.percent, 0)
  const reserved = usageView(wallet(pool(1, 0.001, { reserved: 0.02 }), pool(1, 0.005, { reserved: 0.01 })), { now })
  assert.equal(reserved.monthly.remaining, '不足 ¥0.01')
  assert.equal(reserved.totalAvailable, '不足 ¥0.01')
  assert.equal(reserved.reserved, '¥0.03'); assert.equal(reserved.hasReserved, true)
  const inconsistent = usageView(wallet(pool(0, 1, { used: 0 })))
  assert.equal(inconsistent.monthly.percent, 0)
})
test('rejects missing, negative, non-finite, string and foreign-currency amounts', () => {
  for (const value of [null, {}, { ...wallet(), currency: 'USD' }, { ...wallet(), available: -1 }, { ...wallet(), permanent: { ...pool(60, 55), reserved: undefined } }, { ...wallet(), monthly: { ...pool(120, 90), total: Infinity } }, { ...wallet(), monthly: { ...pool(120, 90), remaining: '90' } }]) {
    assert.throws(() => validateAllowance(value), /额度数据暂不可用/)
    assert.equal(usageView(value).totalAvailable, '—')
  }
})
test('invalid dates never render Invalid Date or create a billing period', () => {
  for (const expiresAt of [null, '2026-11-01', -1, Infinity, 9e18]) {
    const sub = validateSubscription({ active: true, expiresAt })
    assert.equal(sub.expiresAt, null)
    const view = usageView({ ...wallet(pool(120, 90)), asOf: 'invalid' }, { subscription: sub, now })
    assert.equal(view.asOf, null); assert.equal(view.monthly.expiresISO, null)
  }
  assert.throws(() => validateSubscription({ active: 'false' }), /订阅状态暂不可用/)
})

test('manual and voucher membership has its own expiry without inventing a monthly grant', () => {
  const subscription = validateSubscription({ active: false, plan: 'free', membership: { active: true, plan: 'pro', expiresAt: end, source: 'benefit', authoritative: true } })
  const view = usageView(wallet(pool(0, 0)), { plan: 'free', subscription, now })
  assert.equal(view.plan, 'pro'); assert.equal(view.membership, 'Pro 会员权益')
  assert.equal(view.monthly.hasPeriod, false); assert.equal(view.monthly.expiresISO, null)
  assert.match(view.membershipStatus, /^会员有效期至 /)
  assert.match(view.membershipNote, /当前没有订阅额度/)
  assert.doesNotMatch(view.monthly.detail, /订阅 Plus/)
  const combined = usageView(wallet(), { plan: 'free', subscription: { ...subscription, expiresAt: end + 86400000 }, now })
  assert.equal(combined.monthly.expiresISO, new Date(end).toISOString())
  assert.equal(combined.monthly.hasPeriod, true)
  assert.equal(combined.membership, 'Pro 会员权益')
  assert.notEqual(combined.membershipStatus, view.membershipStatus)
})
test('authoritative revoked membership wins over stale Apple context and cached Pro identity', () => {
  const subscription = validateSubscription({ active: true, plan: 'pro', expiresAt: end, membership: { active: false, plan: 'free', expiresAt: null, source: 'none', authoritative: true } })
  const view = usageView(wallet(pool(0, 0)), { plan: 'pro', subscription, now })
  assert.equal(view.plan, 'free'); assert.equal(view.membership, '免费账户')
  assert.equal(view.monthly.hasPeriod, false); assert.equal(view.membershipNote, '')
  for (const membership of [null, {}, { active: true, source: 'unsupported' }]) {
    assert.throws(() => validateSubscription({ active: true, plan: 'pro', membership }))
  }
  for (const membership of [
    { active: true, plan: 'pro', expiresAt: end, authoritative: true },
    { active: true, plan: 'pro', expiresAt: end, authoritative: true, source: 'apple-context' },
    { active: 1, plan: 'pro', expiresAt: end, authoritative: true, source: 'apple' },
  ]) assert.throws(() => validateSubscription({ active: true, plan: 'pro', membership }))
  const unknown = usageView(wallet(), { plan: 'pro', subscription: null, now })
  assert.equal(unknown.membership, '会员状态待确认'); assert.equal(unknown.monthly.hasPeriod, true)
})
test('legacy entitlement cannot invalidate a real funded trial billing period', () => {
  const view = usageView(wallet(), { plan: 'pro', subscription: { active: false, plan: 'pro', source: 'legacy', authoritative: false }, now })
  assert.equal(view.membership, 'Pro 会员权益')
  assert.equal(view.monthly.hasPeriod, true); assert.equal(view.monthly.historical, false)
  assert.equal(view.monthly.expiresISO, new Date(end).toISOString())
  const oldContext = usageView(wallet(), { plan: 'pro', subscription: validateSubscription({ active: false, plan: 'free' }), now })
  assert.equal(oldContext.monthly.hasPeriod, true); assert.equal(oldContext.monthly.historical, false)
  assert.equal(oldContext.membership, 'Pro 会员权益')
  const trial = usageView(wallet(), { plan: 'pro', subscription: { active: true, plan: 'pro', source: 'experience', expiresAt: end, authoritative: true }, now })
  assert.equal(trial.membership, 'Pro 体验会员'); assert.equal(trial.monthly.hasPeriod, true)
})
