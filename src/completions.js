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
  if (typeof cursor === 'string') return { completionID: cursor, eventID: 'history' }
  return cursor ?? { completionID: null, eventID: null }
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
    return store.flush().catch((error) => log(`completion state save failed: ${error.message}`))
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
    if (previous.completionID === record.id) {
      if (previous.eventID !== null && previous.eventID !== undefined) return false
      if (eventID === 'history') return false
    }

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
      return false
    }

    cursors[session.id] = { completionID: record.id, eventID }
    await saveCursors(cursors)
    return true
  }

  async function processSession(session, { initial = false, event = null } = {}) {
    const messages = await client.listAllMessages(session.id)
    const records = completionRecords(messages)
    const state = store.get()
    const cursors = { ...(state.completionCursors ?? {}) }
    const hasCursor = Object.hasOwn(cursors, session.id)
    const cursor = normalizeCursor(cursors[session.id])

    if (!hasCursor && initial) {
      const oldRecords = records.filter((record) => record.created < startedAt)
      const currentRecords = records.filter((record) => record.created >= startedAt)
      const latestOld = oldRecords.at(-1)
      cursors[session.id] = { completionID: latestOld?.id ?? null, eventID: 'history' }
      await saveCursors(cursors)
      for (const record of currentRecords) await sendRecord(session, record)
      return
    }

    let cursorIndex = cursor.completionID
      ? records.findIndex((record) => record.id === cursor.completionID)
      : -1
    let pending = cursorIndex >= 0 ? records.slice(cursorIndex + 1) : records

    if (!hasCursor && !initial) {
      // A session created while the bridge was offline has no cursor yet;
      // its successful turns are new work, not an initial-history baseline.
      pending = records
    }

    if (event && pending.length === 0) {
      const latest = records.at(-1)
      if (latest && latest.id === cursor.completionID && cursor.eventID === 'history' && event.created >= startedAt) {
        pending = [latest]
      }
    }

    for (let index = 0; index < pending.length; index += 1) {
      const record = pending[index]
      const eventID = event && index === pending.length - 1 ? event.id : 'history'
      await sendRecord(session, record, eventID)
    }

    if (!hasCursor && !pending.length) {
      cursors[session.id] = { completionID: null, eventID: 'history' }
      await saveCursors(cursors)
    }
  }

  async function syncHistory({ initial = false } = {}) {
    let list
    try {
      list = await loadSessions()
    } catch (error) {
      log(`completion session list failed: ${error.message}`)
      return
    }

    let complete = true
    for (const session of list) {
      try {
        await processSession(session, { initial })
      } catch (error) {
        complete = false
        log(`completion history failed for ${session.id}: ${error.message}`)
      }
    }
    if (initial && complete) {
      store.set({ completionInitialized: true })
      await store.flush().catch((error) => log(`completion state save failed: ${error.message}`))
    }
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
