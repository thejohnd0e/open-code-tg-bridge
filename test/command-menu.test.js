import test from 'node:test'
import assert from 'node:assert/strict'
import { createBot } from '../src/bot.js'

test('bot registers English descriptions for the unchanged slash commands at startup', async () => {
  let registered
  const bridge = createBot({
    token: '123:test-token',
    client: {},
    store: { get: () => ({ ownerID: 7 }), set: () => {}, flush: async () => {} },
    config: { ownerID: 7 },
    log: () => {},
  })
  bridge.bot.api.setMyCommands = async (commands) => { registered = commands }
  bridge.bot.start = async () => {}
  bridge.bot.stop = async () => {}

  try {
    await bridge.start()
  } finally {
    await bridge.stop()
  }

  assert.deepEqual(registered.map(({ command }) => command), ['sessions', 'status', 'new', 'model', 'help'])
  assert.deepEqual(registered.map(({ description }) => description), [
    'Choose a session from any project',
    'Show the current session',
    'Create a lightweight session',
    'Change the session model',
    'Show help',
  ])
})
