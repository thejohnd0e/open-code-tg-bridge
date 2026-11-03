import test from 'node:test'
import assert from 'node:assert/strict'
import { pollPermissionCards } from '../src/permissions.js'

function fakeClient(overrides = {}) {
  return {
    activeSessions: async () => ['s1'],
    listSessions: async () => [{ id: 's1', title: 'Проверка связей', location: { directory: 'D:\\Proj' } }],
    sessionPermissions: async () => [{ id: 'per_1', sessionID: 's1', action: 'shell', resources: ['whoami'] }],
    ...overrides,
  }
}

test('карточка уходит с проектом и коротким ключом', async () => {
  const sent = []
  const cards = new Map()
  await pollPermissionCards({
    client: fakeClient(),
    ownerID: 1,
    cards,
    seen: new Set(),
    keySeq: { value: 0 },
    sendMessage: async (...args) => sent.push(args),
  })
  assert.equal(sent.length, 1)
  const [chatID, text, options] = sent[0]
  assert.equal(chatID, 1)
  assert.match(text, /whoami/)
  assert.match(text, /Проверка связей/)
  const buttons = options.reply_markup.inline_keyboard[0]
  assert.deepEqual(buttons.map(({ text }) => text), ['Allow once', 'Always allow', 'Deny'])
  assert.match(text, /Approval required: shell/)
  assert.match(text, /Session: Проверка связей/)
  assert.equal(buttons[0].callback_data, 'perm:1:once')
  assert.deepEqual(cards.get('1'), { sessionID: 's1', requestID: 'per_1' })
})

test('один и тот же запрос не присылается дважды', async () => {
  const sent = []
  const seen = new Set()
  const args = { client: fakeClient(), ownerID: 1, cards: new Map(), seen, keySeq: { value: 0 }, sendMessage: async (...a) => sent.push(a) }
  await pollPermissionCards(args)
  await pollPermissionCards(args)
  assert.equal(sent.length, 1)
})

test('сессия, у которой подтверждений нет, не мешает остальным', async () => {
  const sent = []
  await pollPermissionCards({
    client: fakeClient({
      activeSessions: async () => ['idle', 's1'],
      sessionPermissions: async (id) => (id === 's1' ? [{ id: 'per_7', sessionID: 's1', action: 'edit', resources: [] }] : []),
    }),
    ownerID: 1,
    cards: new Map(),
    seen: new Set(),
    keySeq: { value: 0 },
    sendMessage: async (...a) => sent.push(a),
  })
  assert.equal(sent.length, 1)
})

test('ошибка Telegram при отправке карточки не помечает запрос увиденным', async () => {
  const sent = []
  const cards = new Map()
  const seen = new Set()
  let fail = true
  const args = {
    client: fakeClient(),
    ownerID: 1,
    cards,
    seen,
    keySeq: { value: 0 },
    sendMessage: async (...values) => {
      if (fail) throw new Error('Telegram unavailable')
      sent.push(values)
    },
  }

  assert.equal(await pollPermissionCards(args), 0)
  assert.equal(seen.has('per_1'), false)
  assert.equal(cards.size, 0)

  fail = false
  assert.equal(await pollPermissionCards(args), 1)
  assert.equal(seen.has('per_1'), true)
  assert.equal(cards.size, 1)
  assert.equal(sent.length, 1)
})
