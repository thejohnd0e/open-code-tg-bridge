const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function assistantText(message) {
  const content = Array.isArray(message?.content) ? message.content : []
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

export function createMirror({
  client,
  store,
  onMessage = () => {},
  onPermission = () => {},
  log = () => {},
  reconnectDelayMs = 2000,
}) {
  const buffers = new Map()
  let watched = store.get().selectedSessionID ?? null
  let controller = null
  let stopped = false

  async function deliver(messageID, text) {
    if (!text || !text.trim()) return
    const last = store.get().lastMirrored
    let chunk = text
    if (last && last.sessionID === watched && last.messageID === messageID) {
      if (text.length <= last.textLength) return
      chunk = text.slice(last.textLength)
    }
    const previous = last
    // claim the chunk before sending so a second `text.ended` for the same
    // message diffs against the right offset; roll back if sending fails
    store.set({ lastMirrored: { sessionID: watched, messageID, textLength: text.length } })
    try {
      await onMessage(watched, chunk)
    } catch (error) {
      log(`mirror send failed: ${error.message}`)
      store.set({ lastMirrored: previous })
      return
    }
    store.flush().catch(() => {})
  }

  function handleEvent(event) {
    const sessionID = event?.data?.sessionID
    if (!watched || sessionID !== watched) return
    const messageID = event.data.assistantMessageID
    switch (event.type) {
      case 'session.text.started':
        if (messageID && !buffers.has(messageID)) buffers.set(messageID, '')
        break
      case 'session.text.delta':
        if (messageID) buffers.set(messageID, (buffers.get(messageID) ?? '') + (event.data.delta ?? ''))
        break
      case 'session.text.ended': {
        if (!messageID) break
        const buffered = buffers.get(messageID) ?? ''
        // the event may carry the whole message text; the buffer accumulates all
        // text segments of the same message, so take whichever is longer
        const text = (event.data.text?.length ?? 0) > buffered.length ? event.data.text : buffered
        log(`mirror deliver ${watched} ${messageID} ${text.length} chars`)
        deliver(messageID, text)
        break
      }
      default:
        break
    }
  }

  async function syncBaseline({ deliver: shouldDeliver = false } = {}) {
    if (!watched) return
    let messages
    try {
      messages = await client.messages(watched, { limit: 20 })
    } catch (error) {
      log(`baseline failed: ${error.message}`)
      return
    }
    const lastAssistant = [...(messages ?? [])].reverse().find((m) => m.type === 'assistant')
    if (!lastAssistant) return
    const text = assistantText(lastAssistant)
    if (!text.trim()) return
    if (shouldDeliver) deliver(lastAssistant.id, text)
    else store.set({ lastMirrored: { sessionID: watched, messageID: lastAssistant.id, textLength: text.length } })
  }

  function watch(sessionID) {
    if (sessionID === watched) return
    log(`mirror watch ${sessionID}`)
    watched = sessionID
    buffers.clear()
    store.set({ selectedSessionID: sessionID, lastMirrored: null })
    store.flush().catch(() => {})
  }

  async function start() {
    stopped = false
    const hadState = Boolean(store.get().lastMirrored)
    let first = true
    while (!stopped) {
      // reconcile with history before subscribing, so an answer that finished
      // while we were asleep or disconnected is still delivered exactly once
      await syncBaseline({ deliver: first ? hadState : true })
      first = false
      controller = new AbortController()
      try {
        await client.eventStream({ signal: controller.signal, onEvent: handleEvent })
      } catch (error) {
        if (stopped) break
        log(`event stream error: ${error.message}`)
      }
      if (stopped) break
      await sleep(reconnectDelayMs)
    }
  }

  function stop() {
    stopped = true
    controller?.abort()
  }

  return { watch, handleEvent, syncBaseline, start, stop }
}
