import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandlers } from '../src/bot.js'

function fakeStore(initial = {}) {
  let data = { ownerID: null, selectedSessionID: null, ...initial }
  return { get: () => data, set: (patch) => (data = { ...data, ...patch }), flush: async () => {} }
}

function fakeClient() {
  return {
    listSessions: async () => [],
    prompt: async () => {},
    pendingPermissions: async () => [],
    activeSessions: async () => [],
    sessionPermissions: async () => [],
  }
}

function fakeCtx(text) {
  const replies = []
  return {
    replies,
    from: { id: 1 },
    chat: { id: 1 },
    message: { text },
    reply: async (body, options) => replies.push({ body, options }),
  }
}

const config = { ownerID: 1, lightDir: 'C:/Example/Project', lightModel: 'opencode-go/gpt-6-luna' }

test('/help перечисляет все команды, голосовые и подтверждения', async () => {
  const handlers = createHandlers({ client: fakeClient(), store: fakeStore(), config, log: () => {}, files: {} })
  const ctx = fakeCtx('/help')
  await handlers.onMessage(ctx)
  const text = ctx.replies[0].body
  for (const expected of ['/sessions', '/status', '/new', '/help', 'голосов', 'подтвержд']) {
    assert.match(text, new RegExp(expected, 'i'), `в /help нет «${expected}»`)
  }
})
