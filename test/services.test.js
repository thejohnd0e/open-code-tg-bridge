import test from 'node:test'
import assert from 'node:assert/strict'
import { startServices } from '../src/services.js'

test('трекер завершений стартует, даже если запуск бота не завершается', async () => {
  let completionsStarted = false
  let botStarted = false
  const services = startServices({
    startCompletions: async () => {
      completionsStarted = true
    },
    startBot: () => {
      botStarted = true
      return new Promise(() => {}) // long polling: never resolves
    },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(completionsStarted, true)
  assert.equal(botStarted, true)
  assert.equal(typeof services.botDone.then, 'function')
})

test('ошибка трекера завершений логируется и не мешает боту', async () => {
  const logs = []
  startServices({
    startCompletions: async () => {
      throw new Error('boom')
    },
    startBot: async () => {},
    log: (line) => logs.push(line),
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(logs.some((line) => /completion tracker stopped: boom/.test(line)))
})
