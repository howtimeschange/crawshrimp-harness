export function usageView(value) {
  const data=value?.data
  const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null
  const used=number(data?.total_used),remaining=number(data?.total_available),total=number(data?.total_granted)
  const unit=number(value?.billing?.quotaPerUnit),rate=number(value?.billing?.exchangeRate)
  const unlimited=data?.unlimited_quota===true
  const percent=!unlimited&&total>0&&remaining!==null?Math.min(100,Math.max(0,remaining/total*100)):null
  const money=v=>v!==null&&unit>0&&rate>0?new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',minimumFractionDigits:2,maximumFractionDigits:2}).format(v/unit*rate):'—'
  return {percent,unlimited,used:money(used),remaining:unlimited?'未设上限':money(remaining),total:unlimited?'未设上限':money(total),expires:data?.expires_at>0?new Date(data.expires_at*1000).toLocaleString('zh-CN'):null,asOf:value?.asOf?new Date(value.asOf).toLocaleTimeString('zh-CN'):null}
}
