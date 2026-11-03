import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionTitle } from '../src/format.js'
import { createHandlers } from '../src/bot.js'

test('заголовок лёгкой сессии содержит дату и время по Москве', () => {
  const title = sessionTitle(new Date('2026-11-03T15:40:00Z'), 'Europe/Moscow')
  assert.equal(title, 'Telegram 03.11 18:40')
})

test('/new создаёт сессию с датой в заголовке', async () => {
  const created = []
  const client = {
    createSession: async (args) => {
      created.push(args)
      return { id: 'ses_new', title: args.title, location: { directory: args.directory } }
    },
    listSessions: async () => [],
    prompt: async () => {},
  }
  let data = { ownerID: 1, selectedSessionID: null }
  const store = { get: () => data, set: (patch) => (data = { ...data, ...patch }), flush: async () => {} }
  const handlers = createHandlers({
    client,
    store,
    config: { ownerID: 1, lightDir: 'C:/Example/Project', lightModel: 'opencode-go/gpt-6-luna' },
    log: () => {},
    files: {},
    now: () => new Date('2026-11-03T15:40:00Z'),
  })
  const replies = []
  await handlers.onMessage({
    from: { id: 1 },
    chat: { id: 1 },
    message: { text: '/new' },
    reply: async (body) => replies.push(body),
  })
  assert.equal(created[0].title, 'Telegram 03.11 18:40')
  assert.match(replies[0], /Telegram 03\.11 18:40/)
})
