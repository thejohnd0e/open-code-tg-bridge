import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionTitle } from '../src/format.js'
import { createHandlers } from '../src/bot.js'

test('light-session title formats the Moscow date in English', () => {
  const title = sessionTitle(new Date('2026-11-03T15:40:00Z'), 'Europe/Moscow')
  assert.equal(title, 'Telegram 11/03 06:40 PM')
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
    chat: { id: 1, type: 'private' },
    message: { text: '/new' },
    reply: async (body) => replies.push(body),
  })
  assert.equal(created[0].title, 'Telegram 11/03 06:40 PM')
  assert.match(replies[0], /Telegram 11\/03 06:40 PM/)
})
