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

function fakeClient({ sessions = [], histories = {}, active = [] } = {}) {
  return {
    listAllSessions: async () => sessions,
    activeSessions: async () => active,
    listAllMessages: async (sessionID) => histories[sessionID] ?? [],
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

test('первичная синхронизация запоминает старую историю без уведомлений', async () => {
  const delivered = []
  const state = store()
  const tracker = createCompletionTracker({
    client: fakeClient({
      sessions: [{ id: 's1', title: 'Old session', location: { directory: 'D:\\Projects\\Old' } }],
      histories: { s1: [assistant('a-old', 'старый ответ', 10), idle('idle-old', 'succeeded', 20)] },
    }),
    store: state,
    onComplete: async (item) => delivered.push(item),
  })

  await tracker.syncHistory({ initial: true })

  assert.deepEqual(delivered, [])
  assert.deepEqual(state.get().completionCursors.s1, { completionID: 'idle-old', eventID: 'history' })
})

test('неудачная первичная сверка не помечает все сессии инициализированными', async () => {
  const state = store()
  const client = fakeClient({ sessions: [{ id: 's1', title: 'Временная ошибка' }] })
  client.listAllMessages = async () => {
    throw new Error('temporary API failure')
  }
  const tracker = createCompletionTracker({ client, store: state, onComplete: async () => {} })

  await tracker.syncHistory({ initial: true })

  assert.equal(state.get().completionInitialized, undefined)
})

test('повторное завершение после сохранённого курсора доставляет только новый ответ', async () => {
  const delivered = []
  const state = store({ completionCursors: { s1: { completionID: 'idle-1', eventID: 'history' } } })
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

test('успешное выполнение без ответа всё равно даёт короткое completion событие', async () => {
  const delivered = []
  const tracker = createCompletionTracker({
    client: fakeClient({
      sessions: [{ id: 's1', title: 'Пустой ответ', location: { directory: 'D:\\Projects\\Demo' } }],
      histories: { s1: [idle('idle-1', 'succeeded', 20)] },
    }),
    store: store({ completionCursors: { s1: { completionID: 'idle-before', eventID: 'history' } } }),
    onComplete: async (item) => delivered.push(item),
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
    sessions: [{ id: 's1', title: 'Новая работа', location: { directory: 'D:\\Projects\\Demo' } }],
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
