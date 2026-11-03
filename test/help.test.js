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
    chat: { id: 1, type: 'private' },
    message: { text },
    reply: async (body, options) => replies.push({ body, options }),
  }
}

const config = { ownerID: 1, lightDir: 'C:/Example/Project', lightModel: 'opencode-go/gpt-6-luna' }

test('/help lists all commands, voice messages, and approval controls in English', async () => {
  const handlers = createHandlers({ client: fakeClient(), store: fakeStore(), config, log: () => {}, files: {} })
  const ctx = fakeCtx('/help')
  await handlers.onMessage(ctx)
  const text = ctx.replies[0].body
  for (const expected of ['/sessions', '/status', '/new', '/model', '/help', 'voice message', 'approval', 'Allow once', 'Deny']) {
    assert.match(text, new RegExp(expected, 'i'), `missing “${expected}” in /help`)
  }
})
