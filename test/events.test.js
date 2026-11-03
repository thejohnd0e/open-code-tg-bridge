import test from 'node:test'
import assert from 'node:assert/strict'
import { createMirror } from '../src/events.js'

function memoryStore(initial = {}) {
  let data = { selectedSessionID: null, lastMirrored: null, ...initial }
  return { get: () => data, set: (patch) => (data = { ...data, ...patch }), flush: async () => {} }
}

function assistant(id, text) {
  return { id, type: 'assistant', content: [{ type: 'text', text }] }
}

test('дельта собирается в один ответ по session.text.ended', () => {
  const calls = []
  const mirror = createMirror({
    client: {},
    store: memoryStore({ selectedSessionID: 's' }),
    onMessage: (sessionID, text) => calls.push(text),
  })
  mirror.watch('s')
  mirror.handleEvent({ type: 'session.text.started', data: { sessionID: 's', assistantMessageID: 'm1' } })
  mirror.handleEvent({ type: 'session.text.delta', data: { sessionID: 's', assistantMessageID: 'm1', delta: 'При' } })
  mirror.handleEvent({ type: 'session.text.delta', data: { sessionID: 's', assistantMessageID: 'm1', delta: 'вет' } })
  mirror.handleEvent({ type: 'session.text.ended', data: { sessionID: 's', assistantMessageID: 'm1' } })
  assert.deepEqual(calls, ['Привет'])
})

test('чужая сессия не зеркалится', () => {
  const calls = []
  const mirror = createMirror({ client: {}, store: memoryStore({ selectedSessionID: 's' }), onMessage: (_, t) => calls.push(t) })
  mirror.watch('s')
  mirror.handleEvent({ type: 'session.text.delta', data: { sessionID: 'other', assistantMessageID: 'm1', delta: 'x' } })
  mirror.handleEvent({ type: 'session.text.ended', data: { sessionID: 'other', assistantMessageID: 'm1' } })
  assert.deepEqual(calls, [])
})

test('после рестарта уже отправленный ответ не дублируется', async () => {
  const calls = []
  const store = memoryStore({
    selectedSessionID: 's',
    lastMirrored: { sessionID: 's', messageID: 'm1', textLength: 6 },
  })
  const mirror = createMirror({
    client: { messages: async () => [assistant('m1', 'Привет')] },
    store,
    onMessage: (_, t) => calls.push(t),
  })
  mirror.watch('s')
  await mirror.syncBaseline({ deliver: true })
  assert.deepEqual(calls, [])
})

test('ответ, пришедший во время перезапуска, доходит один раз', async () => {
  const calls = []
  const store = memoryStore({
    selectedSessionID: 's',
    lastMirrored: { sessionID: 's', messageID: 'm1', textLength: 6 },
  })
  const mirror = createMirror({
    client: { messages: async () => [assistant('m1', 'Привет, мир')] },
    store,
    onMessage: (_, t) => calls.push(t),
  })
  mirror.watch('s')
  await mirror.syncBaseline({ deliver: true })
  await mirror.syncBaseline({ deliver: true })
  assert.deepEqual(calls, [', мир'])
})

test('текст берётся из session.text.ended, если дельты пропущены', () => {
  const calls = []
  const mirror = createMirror({ client: {}, store: memoryStore({ selectedSessionID: 's' }), onMessage: (_, t) => calls.push(t) })
  mirror.watch('s')
  mirror.handleEvent({ type: 'session.text.ended', data: { sessionID: 's', assistantMessageID: 'm9', text: 'Готово' } })
  assert.deepEqual(calls, ['Готово'])
})

test('ошибка отправки логируется и не рвёт поток событий', async () => {
  const logs = []
  const mirror = createMirror({
    client: {},
    store: memoryStore({ selectedSessionID: 's' }),
    log: (line) => logs.push(line),
    onMessage: async () => {
      throw new Error('403 Forbidden')
    },
  })
  mirror.watch('s')
  mirror.handleEvent({ type: 'session.text.ended', data: { sessionID: 's', assistantMessageID: 'm1', text: 'Привет' } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(logs.some((line) => /403 Forbidden/.test(line)))
})
