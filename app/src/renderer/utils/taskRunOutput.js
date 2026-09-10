// A task instance retains history; its output panel presents one run at a time.
export function parseRunFiles(value) {
  try {
    const files = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(files) ? [...new Set(files.map(file => String(file || '').trim()).filter(Boolean))] : []
  } catch { return [] }
}

export function currentRunOutput(detail, requestedRunId = null) {
  const runs = detail?.runs || []
  const runId = requestedRunId ?? runs[0]?.run_id ?? detail?.summary?.run_id
  const run = runs.find(item => String(item.run_id) === String(runId))
  const summary = !runId || String(detail?.summary?.run_id) === String(runId) ? (detail?.summary || {}) : {}
  // Even an empty output_files list is authoritative for a stopped/zero-result run.
  const files = run ? parseRunFiles(run.output_files)
    : runId ? parseRunFiles(summary.output_files)
    : parseRunFiles(summary.output_files).concat((detail?.artifacts || []).filter(a => !a.meta?.run_id).map(a => a.path).filter(Boolean))
  return { runId, summary, files: [...new Set(files)] }
}

export function cloudDriveDownloadSummary(rows) {
  const data = Array.isArray(rows) ? rows : []
  if (!data.length || !data.some(row => Object.hasOwn(row, '下载结果'))) return null
  const unmatched = new Set()
  let downloaded = 0
  let failed = 0
  for (const row of data) {
    const status = String(row['下载结果'] || '')
    if (status === '已下载') downloaded++
    else if (status === '未匹配到图片') unmatched.add(String(row['输入编码'] || '').trim())
    else if (status.includes('失败')) failed++
  }
  return { downloaded, unmatched: unmatched.size, failed,
    text: `下载 ${downloaded} 张，未匹配 ${unmatched.size} 个款号${failed ? `，失败 ${failed} 张` : ''}` }
}

export async function readCloudDriveDownloadSummary(adapterId, taskId, files, readExcel) {
  if (adapterId !== 'semir-cloud-drive' || taskId !== 'batch_image_download') return null
  const file = files.find(file => /\.xlsx?$/i.test(file))
  if (!file) return null
  const data = await readExcel(file)
  return cloudDriveDownloadSummary(data?.rows)
}

// The backend keeps all runs in one log stream with an explicit start separator.
export function latestRunLogs(lines) {
  if (!Array.isArray(lines)) return []
  const start = lines.findLastIndex(line => /^─── 新运行 /.test(String(line)))
  return start >= 0 ? lines.slice(start) : [...lines]
}
