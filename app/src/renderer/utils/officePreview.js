function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

// Opening an Office file is independent of whether its chat artifact included
// preview metadata. The server resolves an existing revision or renders a copy.
export async function resolveOfficePreview(path, { api, signal, pollInterval = 750, timeout = 330000 } = {}) {
  const deadline = Date.now() + timeout
  let jobId
  while (true) {
    signal.throwIfAborted()
    const result = await api('POST', '/agent/artifacts/office-preview', { path, ...(jobId ? { job_id: jobId } : {}) })
    signal.throwIfAborted()
    if (result.state === 'completed') {
      if (!result.office?.pages?.length) throw new Error('未生成可显示的预览页面，请重新读取文件')
      return result.office
    }
    if (!['queued', 'running'].includes(result.state)) {
      throw new Error(result.error?.message || '文档预览生成失败，请重新读取文件')
    }
    jobId = result.job_id
    if (!jobId) throw new Error('预览作业未返回编号，请重新读取文件')
    if (Date.now() >= deadline) throw new Error('文档预览生成超时，请稍后重新读取文件')
    await delay(pollInterval, signal)
  }
}
