'use strict'
const { performance, monitorEventLoopDelay } = require('node:perf_hooks')
function createPerformanceDiagnostics({ enabled = process.env.CRAWSHRIMP_PERF === '1' } = {}) {
  const spans = new Map(), marks = {}
  const loop = enabled ? monitorEventLoopDelay({ resolution: 20 }) : null
  loop?.enable()
  return {
    mark(name) { if (enabled && Object.keys(marks).length < 32) marks[name] = performance.now() },
    async measure(name, fn) {
      if (!enabled) return fn()
      const start = performance.now()
      try { return await fn() } finally {
        if (!spans.has(name) && spans.size < 128) spans.set(name, { count: 0, totalMs: 0, maxMs: 0, samples: [] })
        const row = spans.get(name)
        if (row) {
          const ms = performance.now() - start
          row.count++; row.totalMs += ms; row.maxMs = Math.max(row.maxMs, ms)
          row.samples.push(ms); if (row.samples.length > 128) row.samples.shift()
        }
      }
    },
    snapshot() {
      return { enabled, platform: process.platform, arch: process.arch, pid: process.pid,
        memory: process.memoryUsage(), marks: { ...marks }, loopP95Ms: loop ? loop.percentile(95) / 1e6 : null,
        spans: Object.fromEntries([...spans].map(([name, row]) => [name, { ...row, samples: [...row.samples] }])) }
    },
    stop() { loop?.disable() },
  }
}
module.exports = { createPerformanceDiagnostics }
