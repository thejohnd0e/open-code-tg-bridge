import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandlers } from '../src/bot.js'

function fakeCtx(text, userID = 1) {
  const replies = []
  return {
    replies,
    from: { id: userID },
    chat: { id: 1, type: 'private' },
    message: { text },
    reply: async (body, options) => replies.push({ body, options }),
  }
}

function createTestHandlers() {
  let state = { ownerID: 1, selectedSessionID: null }
  const store = { get: () => state, set: (patch) => (state = { ...state, ...patch }), flush: async () => {} }
  const client = { listSessions: async () => [], createSession: async () => ({ id: 'ses_new' }), prompt: async () => {} }
  return createHandlers({
    client,
    store,
    config: { ownerID: 1, lightDir: 'C:/Example/Project', lightModel: 'opencode-go/gpt-6-luna' },
    log: () => {},
    files: {},
  })
}

const expectedRows = [
  [{ text: 'Сессии' }, { text: 'Новая' }],
  [{ text: 'Модель' }, { text: 'Статус' }, { text: 'Помощь' }],
]

for (const command of ['/start', '/help']) {
  test(`${command} показывает постоянную клавиатуру с пятью командами`, async () => {
    const handlers = createTestHandlers()
    const ctx = fakeCtx(command)
    await handlers.onMessage(ctx)
    const keyboard = ctx.replies[0].options.reply_markup
    assert.deepEqual(keyboard.keyboard, expectedRows)
    assert.equal(keyboard.resize_keyboard, true)
    assert.equal(keyboard.is_persistent, true)
    assert.equal(keyboard.one_time_keyboard, false)
  })
}

test('чужой пользователь не получает reply keyboard', async () => {
  const handlers = createTestHandlers()
  const ctx = fakeCtx('/start', 42)
  await handlers.onMessage(ctx)
  assert.deepEqual(ctx.replies, [])
})
