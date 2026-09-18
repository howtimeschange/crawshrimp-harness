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
  reconnectDelayMs = 250,
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
    if (record.retryTimer) clearTimeout(record.retryTimer)
    record.retryTimer = null
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
    // Reconnect snapshots also contain the real terminal frame if a turn
    // completed while the socket was unavailable. Never replace it with a
    // transport-generated interruption, or replay an already projected frame.
    const pending = record.hasSnapshot ? events : activeTurnEvents(events)
    record.hasSnapshot = true
    for (const event of pending) forwardEvent(record, event)
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
      hasSnapshot: false,
      hadReady: false,
      retries: 0,
      retryTimer: null,
      connection: 0,
    }
    records.set(normalized, record)
    return await connect(record, runtime)
  }

  const connect = async (record, runtime) => {
    const normalized = record.sessionId
    const connection = ++record.connection
    const current = () => !record.closed && record.connection === connection
    const onError = (error) => {
      if (!current() || record.state === 'reconnecting') return
      logError(`[worker] native Web Session follow ${normalized} failed: ${errorMessage(error)}`)
      if (!record.hadReady) {
        closeRecord(record, { state: 'failed' })
        return
      }
      // A socket failure says nothing about the Host turn's outcome. Retain
      // ownership and its cursor, then reconcile against the next snapshot.
      record.state = 'reconnecting'
      try { record.follow?.close() } catch {}
      const delay = Math.min(4000, reconnectDelayMs * 2 ** Math.min(record.retries++, 4))
      record.retryTimer = setTimeout(() => {
        record.retryTimer = null
        if (!current() || getRuntime() !== runtime) return
        record.state = 'connecting'
        void connect(record, runtime)
      }, delay)
      record.retryTimer.unref?.()
    }
    try {
      record.follow = runtime.follow(normalized, {
        onSnapshot: () => {},
        onSnapshotComplete: (events) => { if (current()) forwardSnapshot(record, events) },
        onEvent: (event) => { if (current()) forwardEvent(record, event) },
        onError,
        firstFrameTimeoutMs,
      })
      await record.follow.ready
      if (!current() || records.get(normalized) !== record || record.state === 'reconnecting') {
        return { ok: false, error: { code: 'SESSION_FOLLOW_FAILED', message: 'follow closed before ready' } }
      }
      record.state = 'ready'
      record.hadReady = true
      record.retries = 0
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

// Product-dispatched runs use the same recovery cursor as native Web turns.
// Only projection/policy errors are fatal; a transport failure cannot prove
// that the Host stopped executing the task.
export function createRecoveringRunFollow({
  runtime, sessionId, onSnapshotComplete = () => {}, onEvent, onError,
  logError = () => {}, reconnectDelayMs = 250,
}) {
  let manager
  let forwardingError = null
  const guarded = callback => value => {
    try { return callback(value) } catch (error) {
      forwardingError = error
      throw error
    }
  }
  const source = {
    follow(id, handlers) {
      return runtime.follow(id, {
        ...handlers,
        onSnapshotComplete: guarded(events => {
          onSnapshotComplete(events)
          handlers.onSnapshotComplete(events)
        }),
        onError: error => {
          if (forwardingError === error) {
            manager.closeAll()
            onError?.(error)
          } else handlers.onError(error)
        },
      })
    },
  }
  manager = createNativeWebFollowManager({
    getRuntime: () => source,
    // The first snapshot predates this queued prompt. Reconnect snapshots
    // replay only frames after the cursor established by that initial gate.
    activeTurnEvents: () => [],
    notify: (_id, event) => guarded(onEvent)(event),
    logError,
    reconnectDelayMs,
  })
  const ready = manager.observe(sessionId, { owner: 'product-run' }).then(result => {
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
  })
  return { ready, close: () => manager.closeAll() }
}
