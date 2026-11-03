import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompletionTracker } from '../src/completions.js'

function idle(id, outcome, created) {
  return { id, type: 'idle', outcome, time: { created } }
}

function assistant(id, text, created) {
  return {
    id,
    type: 'assistant',
    time: { created },
    content: [{ type: 'text', text }],
  }
}

function store(initial = {}) {
  let data = { completionCursors: {}, ...initial }
  return {
    get: () => data,
    set: (patch) => (data = { ...data, ...patch }),
    flush: async () => {},
  }
}

function fakeClient({ sessions = [], histories = {}, active = [], onMessages = () => {} } = {}) {
  return {
    listAllSessions: async () => sessions,
    activeSessions: async () => active,
    listAllMessages: async (sessionID) => {
      onMessages(sessionID)
      return histories[sessionID] ?? []
    },
    eventStream: async () => {},
  }
}

test('успешное завершение любой сессии отдаёт последний ответ и имя проекта', async () => {
  const delivered = []
  const client = fakeClient({
    sessions: [{ id: 's2', title: 'Ping check', location: { directory: 'C:/Example/project-alpha' } }],
    histories: {
      s2: [
        idle('idle-old', 'succeeded', 10),
        { type: 'user', id: 'u1', time: { created: 20 } },
        assistant('a1', 'pong', 30),
        idle('idle-new', 'succeeded', 40),
      ],
    },
  })
  const tracker = createCompletionTracker({ client, store: store({ completionCursors: { s2: { completionID: 'idle-old', eventID: 'history' } } }), onComplete: async (item) => delivered.push(item) })

  await tracker.handleEvent({ id: 'evt-new', type: 'session.execution.succeeded', data: { sessionID: 's2' } })

  assert.deepEqual(delivered, [{
    sessionID: 's2',
    project: 'project-alpha',
    title: 'Ping check',
    text: 'pong',
    completionID: 'idle-new',
  }])
})

test('текстовый сегмент без успешного завершения не отправляется', async () => {
  const delivered = []
  const tracker = createCompletionTracker({ client: fakeClient(), store: store(), onComplete: async (item) => delivered.push(item) })
  await tracker.handleEvent({ type: 'session.text.ended', data: { sessionID: 's1', assistantMessageID: 'a1', text: 'ещё работаю' } })
  assert.deepEqual(delivered, [])
})

test('в итог уходит только последнее assistant-сообщение хода', async () => {
  const delivered = []
  const client = fakeClient({
    sessions: [{ id: 's1', title: 'Работа', location: { directory: 'D:\\Projects\\Demo' } }],
    histories: {
      s1: [
        idle('idle-0', 'succeeded', 10),
        { type: 'user', id: 'u1', time: { created: 20 } },
        assistant('a1', 'Сейчас проверю файл.', 30),
        assistant('a2', 'Готово, тесты прошли.', 40),
        idle('idle-1', 'succeeded', 50),
      ],
    },
  })
  const tracker = createCompletionTracker({
    client,
    store: store({ completionCursors: { s1: { completionID: 'idle-0', eventID: 'history' } } }),
    onComplete: async (item) => delivered.push(item),
  })

  await tracker.handleEvent({ id: 'evt-1', created: 55, type: 'session.execution.succeeded', data: { sessionID: 's1' } })

  assert.equal(delivered[0].text, 'Готово, тесты прошли.')
})

test('сбой или отмена выполнения не помечаются как завершённый успех', async () => {
  const delivered = []
  const tracker = createCompletionTracker({ client: fakeClient(), store: store(), onComplete: async (item) => delivered.push(item) })
  await tracker.handleEvent({ type: 'session.execution.failed', data: { sessionID: 's1' } })
  await tracker.handleEvent({ type: 'session.execution.interrupted', data: { sessionID: 's1' } })
  assert.deepEqual(delivered, [])
})

test('первичная синхронизация сохраняет per-session updatedAt без чтения истории', async () => {
  const state = store()
  const historyCalls = []
  const tracker = createCompletionTracker({
    client: fakeClient({
      sessions: [
        { id: 's1', title: 'Old 1', time: { updated: 100 } },
        { id: 's2', title: 'Old 2', time: { updated: 200 } },
      ],
      histories: { s1: [assistant('a-old', 'старый ответ', 10), idle('idle-old', 'succeeded', 20)] },
      onMessages: (sessionID) => historyCalls.push(sessionID),
    }),
    store: state,
    onComplete: async () => {},
    startedAt: 300,
  })
  await tracker.syncHistory({ initial: true })

  assert.equal(state.get().completionInitialized, true)
  assert.deepEqual(state.get().completionCursors, {
    s1: { completionID: null, eventID: 'history', updatedAt: 100 },
    s2: { completionID: null, eventID: 'history', updatedAt: 200 },
  })
  assert.deepEqual(historyCalls, [])
})

test('неудачная reconnect-сверка не продвигает per-session cursor', async () => {
  const state = store()
  state.set({ completionInitialized: true, completionCursors: { s1: { completionID: 'idle-old', eventID: 'history', updatedAt: 20 } } })
  const client = fakeClient({ sessions: [{ id: 's1', title: 'Временная ошибка', time: { updated: 30 } }] })
  client.listAllMessages = async () => {
    throw new Error('temporary API failure')
  }
  const tracker = createCompletionTracker({ client, store: state, onComplete: async () => {}, startedAt: 10 })

  await tracker.syncHistory()

  assert.equal(state.get().completionCursors.s1.updatedAt, 20)
})

test('reconnect reads histories only for sessions updated since their cursor', async () => {
  const delivered = []
  const historyCalls = []
  const state = store({
    completionInitialized: true,
    completionCursors: {
      unchanged: { completionID: 'u-idle', eventID: 'history', updatedAt: 10 },
      changed: { completionID: 'c-idle-old', eventID: 'history', updatedAt: 20 },
    },
  })
  const tracker = createCompletionTracker({
    client: fakeClient({
      sessions: [
        { id: 'unchanged', title: 'Старая', time: { updated: 10 } },
        { id: 'changed', title: 'Новая', location: { directory: 'D:\\Projects\\New' }, time: { updated: 60 } },
      ],
      histories: {
        unchanged: [assistant('u1', 'не трогать', 5), idle('u-idle', 'succeeded', 10)],
        changed: [
          assistant('c0', 'старый итог', 5), idle('c-idle-old', 'succeeded', 10),
          assistant('c1', 'новый итог', 30), idle('c-idle-new', 'succeeded', 40),
        ],
      },
      onMessages: (sessionID) => historyCalls.push(sessionID),
    }),
    store: state,
    onComplete: async (item) => delivered.push(item),
  })

  await tracker.syncHistory()

  assert.deepEqual(historyCalls, ['changed'])
  assert.deepEqual(delivered.map((item) => item.text), ['новый итог'])
  assert.equal(state.get().completionCursors.changed.updatedAt, 60)
})

test('reconnect delivers a new success even if the session had no prior completion cursor', async () => {
  const delivered = []
  const state = store({
    completionInitialized: true,
    completionCursors: { s1: { completionID: null, eventID: 'history', updatedAt: 20 } },
  })
  const tracker = createCompletionTracker({
    client: fakeClient({
      sessions: [{ id: 's1', title: 'Первая работа', location: { directory: 'D:\\Projects\\Demo' }, time: { updated: 40 } }],
      histories: { s1: [assistant('a1', 'новый итог', 30), idle('idle-1', 'succeeded', 35)] },
    }),
    store: state,
    onComplete: async (item) => delivered.push(item),
  })

  await tracker.syncHistory()

  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].completionID, 'idle-1')
})

test('повторное завершение после сохранённого курсора доставляет только новый ответ', async () => {
  const delivered = []
  const state = store({ completionInitialized: true, completionCursors: { s1: { completionID: 'idle-1', eventID: 'history', updatedAt: 20 } } })
  const client = fakeClient({
    sessions: [{ id: 's1', title: 'Рабочая сессия', location: { directory: 'D:\\Projects\\Demo' } }],
    histories: {
      s1: [
        assistant('a1', 'первый', 10), idle('idle-1', 'succeeded', 20),
        assistant('a2', 'второй', 30), idle('idle-2', 'succeeded', 40),
        assistant('a3', 'третий', 50), idle('idle-3', 'succeeded', 60),
      ],
    },
  })
  const tracker = createCompletionTracker({ client, store: state, onComplete: async (item) => delivered.push(item) })

  await tracker.syncHistory()
  await tracker.syncHistory()

  assert.deepEqual(delivered.map((item) => [item.completionID, item.text]), [['idle-2', 'второй'], ['idle-3', 'третий']])
})

test('ошибка второго итога не продвигает updatedAt мимо него', async () => {
  const delivered = []
  const state = store({ completionInitialized: true, completionCursors: { s1: { completionID: 'idle-0', eventID: 'history', updatedAt: 10 } } })
  const client = fakeClient({
    sessions: [{ id: 's1', title: 'Работа', location: { directory: 'D:\\Projects\\Demo' }, time: { updated: 60 } }],
    histories: {
      s1: [
        assistant('a0', 'старый', 5), idle('idle-0', 'succeeded', 10),
        assistant('a1', 'первый новый', 20), idle('idle-1', 'succeeded', 30),
        assistant('a2', 'второй новый', 40), idle('idle-2', 'succeeded', 50),
      ],
    },
  })
  let failSecond = true
  const tracker = createCompletionTracker({
    client,
    store: state,
    onComplete: async (item) => {
      delivered.push(item.completionID)
      if (item.completionID === 'idle-2' && failSecond) throw new Error('Telegram unavailable')
    },
  })

  await tracker.syncHistory()
  failSecond = false
  await tracker.syncHistory()

  assert.deepEqual(delivered, ['idle-1', 'idle-2', 'idle-2'])
  assert.equal(state.get().completionCursors.s1.completionID, 'idle-2')
})

test('успешное выполнение без ответа всё равно даёт короткое completion событие', async () => {
  const delivered = []
  const tracker = createCompletionTracker({
    client: fakeClient({
      sessions: [{ id: 's1', title: 'Пустой ответ', location: { directory: 'D:\\Projects\\Demo' } }],
      histories: { s1: [idle('idle-1', 'succeeded', 20)] },
    }),
    store: store({ completionCursors: { s1: { completionID: 'idle-before', eventID: 'history', updatedAt: 10 } } }),
    onComplete: async (item) => delivered.push(item),
    startedAt: 0,
  })

  await tracker.handleEvent({ id: 'evt-1', type: 'session.execution.succeeded', data: { sessionID: 's1' } })

  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].text, '')
  assert.equal(delivered[0].completionID, 'idle-1')
})

test('completion event queued during initial sync is sent once after baseline', async () => {
  const delivered = []
  const histories = { s1: [assistant('a0', 'до запуска', 5), idle('idle-0', 'succeeded', 8)] }
  const client = fakeClient({
    sessions: [{ id: 's1', title: 'Новая работа', location: { directory: 'D:\\Projects\\Demo' }, time: { updated: 8 } }],
    histories,
  })
  const state = store()
  const tracker = createCompletionTracker({ client, store: state, onComplete: async (item) => delivered.push(item), startedAt: 10 })

  await tracker.syncHistory({ initial: true })
  histories.s1.push(assistant('a1', 'готово', 20), idle('idle-1', 'succeeded', 30))
  await tracker.handleEvent({ id: 'evt-1', created: 35, type: 'session.execution.succeeded', data: { sessionID: 's1' } })
  await tracker.handleEvent({ id: 'evt-1', created: 35, type: 'session.execution.succeeded', data: { sessionID: 's1' } })

  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].completionID, 'idle-1')
})

test('two successes queued while first-start baseline is loading are both delivered in order', async () => {
  const delivered = []
  const histories = {
    s1: [
      assistant('a-old', 'исторический ответ', 5), idle('idle-old', 'succeeded', 8),
      assistant('a1', 'первый новый итог', 20), idle('idle-1', 'succeeded', 24),
      assistant('a2', 'второй новый итог', 30), idle('idle-2', 'succeeded', 34),
    ],
  }
  const client = fakeClient({
    sessions: [{ id: 's1', title: 'Работа', location: { directory: 'D:\\Projects\\Demo' }, time: { updated: 34 } }],
    histories,
  })
  const state = store()
  const tracker = createCompletionTracker({ client, store: state, onComplete: async (item) => delivered.push(item.completionID), startedAt: 10 })

  await tracker.syncHistory({ initial: true })
  await tracker.handleEvent({ id: 'evt-1', created: 25, type: 'session.execution.succeeded', data: { sessionID: 's1' } })
  await tracker.handleEvent({ id: 'evt-2', created: 35, type: 'session.execution.succeeded', data: { sessionID: 's1' } })

  assert.deepEqual(delivered, ['idle-1', 'idle-2'])
})

test('failed completion send is retried while the SSE connection stays open', async () => {
  const history = [assistant('a0', 'old', 5), idle('idle-0', 'succeeded', 10)]
  const sessions = [{ id: 's1', title: 'Retry', location: { directory: 'D:\\Projects\\Retry' }, time: { updated: 10 } }]
  let attempts = 0
  const state = store()
  const client = fakeClient({ sessions, histories: { s1: history } })
  client.eventStream = async ({ onEvent, signal }) => {
    await onEvent({ id: 'connected', type: 'server.connected', data: {} })
    history.push(assistant('a1', 'retry me', 20), idle('idle-1', 'succeeded', 21))
    sessions[0].time.updated = 21
    await onEvent({ id: 'evt-1', type: 'session.execution.succeeded', created: 22, data: { sessionID: 's1' } })
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
  }
  const tracker = createCompletionTracker({
    client,
    store: state,
    syncIntervalMs: 10,
    startedAt: 0,
    onComplete: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('Telegram temporarily unavailable')
    },
  })
  const running = tracker.start()
  let timeout
  let checkInterval
  try {
    await Promise.race([
      new Promise((resolve) => {
        checkInterval = setInterval(() => {
          if (attempts >= 2) resolve()
        }, 5)
      }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('completion retry did not run')), 1000) }),
    ])
    assert.equal(state.get().completionCursors.s1.completionID, 'idle-1')
  } finally {
    clearTimeout(timeout)
    clearInterval(checkInterval)
    tracker.stop()
    await running
  }
})

test('periodic history sync and SSE completion are serialized per session', async () => {
  const delivered = []
  const state = store({
    completionInitialized: true,
    completionCursors: { s1: { completionID: 'idle-0', eventID: 'history', updatedAt: 10 } },
  })
  const client = fakeClient({
    sessions: [{ id: 's1', title: 'Параллельная сессия', location: { directory: 'D:\\Projects\\Demo' }, time: { updated: 40 } }],
    histories: {
      s1: [assistant('a0', 'старый', 5), idle('idle-0', 'succeeded', 10), assistant('a1', 'новый', 30), idle('idle-1', 'succeeded', 40)],
    },
  })
  const tracker = createCompletionTracker({
    client,
    store: state,
    onComplete: async (item) => {
      delivered.push(item.completionID)
      await new Promise((resolve) => setImmediate(resolve))
    },
  })

  await Promise.all([
    tracker.syncHistory(),
    tracker.handleEvent({ id: 'evt-1', created: 41, type: 'session.execution.succeeded', data: { sessionID: 's1' } }),
  ])

  assert.deepEqual(delivered, ['idle-1'])
})
