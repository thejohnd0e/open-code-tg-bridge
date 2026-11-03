const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function textOf(message) {
  return (message?.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function completionRecords(messages) {
  const ordered = [...(messages ?? [])].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
  const records = []
  let assistantMessages = []

  for (const message of ordered) {
    if (message.type === 'assistant') {
      assistantMessages.push(message)
      continue
    }
    if (message.type !== 'idle') continue

    if (message.outcome === 'succeeded') {
      const lastAssistant = assistantMessages.at(-1)
      records.push({
        id: message.id,
        created: message.time?.created ?? 0,
        assistantID: lastAssistant?.id ?? null,
        text: lastAssistant ? textOf(lastAssistant) : '',
      })
    }
    assistantMessages = []
  }

  return records
}

function normalizeCursor(cursor) {
  if (typeof cursor === 'string') return { completionID: cursor, eventID: 'history', updatedAt: 0 }
  return cursor ?? { completionID: null, eventID: null, updatedAt: null }
}

function projectName(session) {
  const directory = session?.location?.directory ?? ''
  return directory.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
}

export function createCompletionTracker({
  client,
  store,
  onComplete = async () => {},
  log = () => {},
  reconnectDelayMs = 2000,
  startedAt = Date.now(),
}) {
  let stopped = false
  let controller = null
  const sessions = new Map()
  const queues = new Map()

  function saveCursors(cursors) {
    store.set({ completionCursors: cursors })
    return store.flush().then(() => true).catch((error) => {
      log(`completion state save failed: ${error.message}`)
      return false
    })
  }

  async function loadSessions() {
    const list = await client.listAllSessions()
    sessions.clear()
    for (const session of list ?? []) sessions.set(session.id, session)
    return list ?? []
  }

  async function sendRecord(session, record, eventID = 'history') {
    const cursors = { ...(store.get().completionCursors ?? {}) }
    const previous = normalizeCursor(cursors[session.id])
    if (previous.completionID === record.id) return 'duplicate'

    try {
      await onComplete({
        sessionID: session.id,
        project: projectName(session),
        title: session.title ?? session.id,
        text: record.text,
        completionID: record.id,
      })
    } catch (error) {
      log(`completion send failed for ${session.id}: ${error.message}`)
      return 'failed'
    }

    cursors[session.id] = {
      ...previous,
      completionID: record.id,
      eventID,
    }
    return (await saveCursors(cursors)) ? 'sent' : 'failed'
  }

  async function processSession(session, { event = null, since } = {}) {
    const messages = await client.listAllMessages(session.id)
    const records = completionRecords(messages)
    const state = store.get()
    const cursors = { ...(state.completionCursors ?? {}) }
    const hasCursor = Object.hasOwn(cursors, session.id)
    const cursor = normalizeCursor(cursors[session.id])
    let cursorIndex = cursor.completionID
      ? records.findIndex((record) => record.id === cursor.completionID)
      : -1
    const cutoff = since ?? cursor.updatedAt ?? session.time?.created ?? startedAt
    let pending = cursorIndex >= 0
      ? records.slice(cursorIndex + 1)
      : records.filter((record) => record.created > cutoff)

    if (event && !hasCursor) {
      // A success event proves this is new work. If several completions arrived
      // before the event queue drained, preserve all records newer than the
      // per-session baseline; otherwise use the latest record as a fallback.
      if (!pending.length && records.length) pending = [records.at(-1)]
    } else if (event && pending.length === 0) {
      const latest = records.at(-1)
      if (latest && latest.id !== cursor.completionID && event.created >= startedAt) {
        pending = [latest]
      }
    }

    for (let index = 0; index < pending.length; index += 1) {
      const record = pending[index]
      const eventID = event && index === pending.length - 1 ? event.id : 'history'
      const result = await sendRecord(session, record, eventID)
      if (result === 'failed') return false
    }

    const after = { ...(store.get().completionCursors ?? {}) }
    const updated = normalizeCursor(after[session.id])
    const latestMessageAt = messages.reduce((latest, message) => Math.max(latest, message.time?.created ?? 0), 0)
    after[session.id] = {
      ...updated,
      eventID: updated.eventID ?? 'history',
      updatedAt: Math.max(updated.updatedAt ?? 0, session.time?.updated ?? 0, latestMessageAt),
    }
    return saveCursors(after)
  }

  async function syncHistory({ initial = false } = {}) {
    let list
    try {
      list = await loadSessions()
    } catch (error) {
      log(`completion session list failed: ${error.message}`)
      return
    }

    const state = store.get()
    if (initial || !state.completionInitialized) {
      const cursors = { ...(state.completionCursors ?? {}) }
      for (const session of list) {
        if (Object.hasOwn(cursors, session.id)) continue
        cursors[session.id] = {
          completionID: null,
          eventID: 'history',
          updatedAt: session.time?.updated ?? startedAt,
        }
      }
      if (!(await saveCursors(cursors))) return
      store.set({ completionInitialized: true })
      await store.flush().catch((error) => log(`completion state save failed: ${error.message}`))
      return
    }

    let complete = true
    for (const session of list) {
      const cursor = store.get().completionCursors?.[session.id]
      const updatedAt = typeof cursor === 'string' ? 0 : cursor?.updatedAt
      const sessionUpdated = session.time?.updated
      if (cursor && Number.isFinite(updatedAt) && Number.isFinite(sessionUpdated) && sessionUpdated <= updatedAt) continue
      try {
        const ok = await processSession(session, { since: updatedAt ?? session.time?.created ?? startedAt })
        if (!ok) complete = false
      } catch (error) {
        complete = false
        log(`completion history failed for ${session.id}: ${error.message}`)
      }
    }
    if (!complete) log('completion history sync incomplete; unchanged cursors will be retried')
  }

  function handleEvent(event) {
    if (event.type !== 'session.execution.succeeded') return Promise.resolve()
    const sessionID = event.data?.sessionID
    if (!sessionID) return Promise.resolve()

    const previous = queues.get(sessionID) ?? Promise.resolve()
    const current = previous
      .catch(() => {})
      .then(async () => {
        let session = sessions.get(sessionID)
        if (!session) {
          try {
            await loadSessions()
            session = sessions.get(sessionID)
          } catch (error) {
            log(`completion session lookup failed for ${sessionID}: ${error.message}`)
          }
        }
        if (!session) {
          session = { id: sessionID, title: sessionID, location: { directory: '' } }
        }
        await processSession(session, { event })
      })
      .catch((error) => log(`completion event failed for ${sessionID}: ${error.message}`))
    queues.set(sessionID, current)
    return current
  }

  async function start() {
    stopped = false
    while (!stopped) {
      controller = new AbortController()
      let bootstrapped = false
      try {
        await client.eventStream({
          signal: controller.signal,
          onEvent: async (event) => {
            if (!bootstrapped) {
              const initial = !store.get().completionInitialized
              await syncHistory({ initial })
              bootstrapped = true
            }
            await handleEvent(event)
          },
        })
      } catch (error) {
        if (stopped) break
        log(`completion event stream error: ${error.message}`)
      }
      if (stopped) break
      await sleep(reconnectDelayMs)
    }
  }

  function stop() {
    stopped = true
    controller?.abort()
  }

  return { handleEvent, syncHistory, start, stop }
}
