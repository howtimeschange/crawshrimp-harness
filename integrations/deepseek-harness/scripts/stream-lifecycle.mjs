import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Backport for 0.1.2-rc.1; 0.2.1-rc.2 supplies the timeout/cleanup fix upstream.
// The caller signal also settles a stuck demand, preserving its original reason.
export function boundedIdleWatchdog(upstream, timeoutMs, code) {
  assertTimerDelay(timeoutMs, 'idleWatchdog timeoutMs')
  const timeout = new AbortController()
  const signal = upstream === undefined ? timeout.signal : AbortSignal.any([upstream, timeout.signal])
  let timer, outstanding = false, disposed = false
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => timeout.abort(new TimeoutReason(code, timeoutMs)), timeoutMs)
  }
  return {
    signal,
    async next(iterator) {
      if (disposed) throw new Error('idleWatchdog is disposed')
      if (outstanding) throw new Error('idleWatchdog next is already outstanding')
      signal.throwIfAborted()
      outstanding = true
      arm()
      let rejectAbort
      const stopped = new Promise((_, reject) => { rejectAbort = reject })
      const onAbort = () => rejectAbort(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        return await Promise.race([Promise.resolve().then(() => iterator.next()), stopped])
      } finally {
        signal.removeEventListener('abort', onAbort)
        clearTimeout(timer)
        timer = undefined
        outstanding = false
      }
    },
    pulse() { if (!disposed && outstanding) arm() },
    [Symbol.dispose]() { disposed = true; clearTimeout(timer); timer = undefined },
  }
}
export function patchIdleWatchdogSource(source) {
  if (source.includes('// crawshrimp-bounded-stream-v1')) return source
  const start = source.indexOf('function idleWatchdog(')
  const end = source.indexOf('\n/**', start)
  if (start < 0 || end < 0) throw new Error('Stream watchdog source contract changed')
  return source.slice(0, start) + '// crawshrimp-bounded-stream-v1\n' + boundedIdleWatchdog.toString().replace('boundedIdleWatchdog', 'idleWatchdog') + '\n' + source.slice(end)
}
export function patchStreamCleanupSource(source) {
  if (source.includes('// crawshrimp-detached-stream-cleanup-v1')) return source
  const before = /try\s*\{\s*await iterator\.return\(void 0\);\s*\} catch \(_abortedSdkTeardown\) \{\}/g
  const count = [...source.matchAll(before)].length
  if (count !== 1) throw new Error(`Stream cleanup source contract changed (${count} matches)`)
  return source.replace(before, '// crawshrimp-detached-stream-cleanup-v1\nvoid iterator.return(void 0).catch(() => {});')
}
export function patchStreamLifecycle(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'node_modules/@deepseek-ai/dsh/package.json')))
  if (pkg.version === '0.2.1-rc.2') return { upstream: true, version: pkg.version }
  if (pkg.version !== '0.1.2-rc.1') throw new Error(`Unsupported stream lifecycle baseline: ${pkg.version}`)
  const plans = [
    ['dsh-timeout', patchIdleWatchdogSource], ['dsh-llm-pi-ai', patchStreamCleanupSource],
  ].map(([name, transform]) => {
    const file = join(root, 'node_modules/@deepseek-ai', name, 'lib/index.js')
    const before = readFileSync(file, 'utf8'), after = transform(before)
    if (transform(after) !== after) throw new Error('Stream lifecycle patch is not idempotent')
    return { file, before, after }
  })
  for (const p of plans) if (p.before !== p.after) writeFileSync(p.file, p.after)
  return { upstream: false, version: pkg.version, files: plans.map(p => p.file) }
}
