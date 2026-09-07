const RUNTIME_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u

function errorMessage(error) {
  return String(error?.message || error || 'Session follow failed')
}

export function createNativeWebFollowManager({
  records = new Map(),
  getRuntime,
  getProductSessionId = () => '',
  activeTurnEvents = (events) => events,
  notify,
  logError = () => {},
  firstFrameTimeoutMs = 8000,
} = {}) {
  if (!(records instanceof Map)) throw new TypeError('records must be a Map')
  if (typeof getRuntime !== 'function') throw new TypeError('getRuntime must be a function')
  if (typeof notify !== 'function') throw new TypeError('notify must be a function')

  const closeRecord = (record, { terminalReason, state = 'closed' } = {}) => {
    if (!record || record.closed) return false
    const interrupted = Boolean(record.turnActive && terminalReason)
    if (interrupted) {
      record.turnActive = false
      notify(record.sessionId, { type: 'turn/end', data: { reason: terminalReason } })
    }
    record.closed = true
    record.state = state
    try { record.follow?.close() } catch {}
    if (records.get(record.sessionId) === record) records.delete(record.sessionId)
    return interrupted
  }

  const forwardEvent = (record, event) => {
    if (record.closed || !event || typeof event !== 'object') return
    const seq = Number(event.seq || 0)
    if (seq && seq <= record.lastSeq) return
    if (seq) record.lastSeq = seq
    if (event.type === 'turn/start') record.turnActive = true
    if (event.type === 'turn/end') record.turnActive = false
    notify(record.sessionId, event)
    // A renderer may navigate away while DSH is still executing. Keep the
    // transport as an internal run owner until the authentic terminal frame,
    // then release it without requiring the old renderer to return.
    if (event.type === 'turn/end' && record.owners.size === 0) closeRecord(record)
  }

  const forwardSnapshot = (record, events) => {
    for (const event of activeTurnEvents(events)) forwardEvent(record, event)
    const maxSnapshotSeq = (Array.isArray(events) ? events : []).reduce((max, event) => (
      Math.max(max, Number(event?.seq || 0) || 0)
    ), record.lastSeq)
    record.lastSeq = maxSnapshotSeq
  }

  const observe = async (sessionId, { refresh = false, owner = '' } = {}) => {
    const runtime = getRuntime()
    if (!runtime) {
      return { ok: false, error: { code: 'RUNTIME_UNAVAILABLE', message: 'DSH Web runtime is not ready' } }
    }
    const normalized = String(sessionId || '').trim()
    if (!RUNTIME_SESSION_ID.test(normalized)) {
      return { ok: false, error: { code: 'INVALID_SESSION_ID', message: 'invalid runtime session id' } }
    }
    if (String(getProductSessionId() || '') === normalized) {
      return { ok: true, following: false, reason: 'product-run-already-followed' }
    }
    const ownerId = String(owner || 'api').trim() || 'api'
    const existing = records.get(normalized)
    if (existing && !existing.closed && !refresh) {
      existing.owners.add(ownerId)
      if (existing.state === 'ready') {
        return {
          ok: true, following: true, idempotent: true, state: 'ready', owners: existing.owners.size,
        }
      }
      try {
        await existing.follow.ready
        if (existing.closed || existing.state !== 'ready' || records.get(normalized) !== existing) {
          return { ok: false, error: { code: 'SESSION_FOLLOW_FAILED', message: 'follow closed before ready' } }
        }
        return {
          ok: true, following: true, idempotent: true, state: 'ready', owners: existing.owners.size,
        }
      } catch (error) {
        return { ok: false, error: { code: 'SESSION_FOLLOW_FAILED', message: errorMessage(error) } }
      }
    }

    const owners = new Set([ownerId])
    if (existing && !existing.closed && refresh) {
      for (const existingOwner of existing.owners) owners.add(existingOwner)
      // Refresh swaps only the transport. It must neither terminate the real
      // DSH turn nor discard renderer ownership while recovery asks for a new
      // active-turn snapshot.
      closeRecord(existing)
    }

    const record = {
      sessionId: normalized,
      follow: null,
      closed: false,
      state: 'connecting',
      lastSeq: 0,
      owners,
      turnActive: false,
    }
    records.set(normalized, record)
    const onError = (error) => {
      if (record.closed) return
      const message = errorMessage(error)
      logError(`[worker] native Web Session follow ${normalized} failed: ${message}`)
      closeRecord(record, {
        state: 'failed',
        terminalReason: {
          kind: 'interrupted',
          error: { code: 'SESSION_FOLLOW_FAILED', message },
        },
      })
    }
    try {
      record.follow = runtime.follow(normalized, {
        onSnapshot: () => {},
        onSnapshotComplete: (events) => forwardSnapshot(record, events),
        onEvent: (event) => forwardEvent(record, event),
        onError,
        firstFrameTimeoutMs,
      })
      await record.follow.ready
      if (record.closed || records.get(normalized) !== record) {
        return { ok: false, error: { code: 'SESSION_FOLLOW_FAILED', message: 'follow closed before ready' } }
      }
      record.state = 'ready'
      return { ok: true, following: true, state: 'ready', owners: record.owners.size }
    } catch (error) {
      onError(error)
      return { ok: false, error: { code: 'SESSION_FOLLOW_FAILED', message: errorMessage(error) } }
    }
  }

  const unobserve = (sessionId, { owner = '' } = {}) => {
    const normalized = String(sessionId || '').trim()
    const record = records.get(normalized)
    if (!record) return { ok: true, following: false, idempotent: true }
    const ownerId = String(owner || 'api').trim() || 'api'
    record.owners.delete(ownerId)
    if (record.owners.size > 0) {
      return { ok: true, following: true, owners: record.owners.size }
    }
    if (record.turnActive) {
      return { ok: true, following: true, owners: 0, heldForActiveTurn: true }
    }
    closeRecord(record)
    return { ok: true, following: false }
  }

  const closeAll = (terminalReason) => {
    const interrupted = []
    for (const record of [...records.values()]) {
      if (closeRecord(record, { terminalReason })) interrupted.push(record.sessionId)
    }
    return interrupted
  }

  const inspect = (sessionId) => {
    const record = records.get(String(sessionId || '').trim())
    if (!record) return null
    return {
      sessionId: record.sessionId,
      state: record.state,
      owners: [...record.owners].sort(),
      turnActive: record.turnActive,
      lastSeq: record.lastSeq,
    }
  }

  return { observe, unobserve, closeAll, inspect }
}
