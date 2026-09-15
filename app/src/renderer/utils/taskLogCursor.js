export function createTaskLogCursor() {
  let cursor, epoch = '', lines = []
  return {
    query: () => ({ ...(cursor === undefined ? {} : { cursor }), epoch }),
    reset() { cursor = undefined; epoch = ''; lines = [] },
    apply(response = {}) {
      const incoming = Array.isArray(response.logs) ? response.logs : []
      lines = response.reset || response.cursor === undefined ? incoming : [...lines, ...incoming]
      const start = lines.findLastIndex(line => /^─── 新运行 /.test(String(line)))
      if (start >= 0) lines = lines.slice(start)
      lines = lines.slice(-2000)
      cursor = response.cursor; epoch = response.epoch || ''
      return lines
    },
  }
}
