// A UI deadline for read-only IPC. Writes must retain their original result semantics.
export async function readRequest(request, timeoutMs = 15000) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(request),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('加载超时，请检查网络后重试')), timeoutMs) }),
    ])
  } finally { clearTimeout(timer) }
}
