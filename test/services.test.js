import test from 'node:test'
import assert from 'node:assert/strict'
import { startServices } from '../src/services.js'

test('зеркало стартует, даже если запуск бота не завершается', async () => {
  let mirrorStarted = false
  let botStarted = false
  const services = startServices({
    startMirror: async () => {
      mirrorStarted = true
    },
    startBot: () => {
      botStarted = true
      return new Promise(() => {}) // long polling: never resolves
    },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(mirrorStarted, true)
  assert.equal(botStarted, true)
  assert.equal(typeof services.botDone.then, 'function')
})

test('ошибка зеркала логируется и не мешает боту', async () => {
  const logs = []
  startServices({
    startMirror: async () => {
      throw new Error('boom')
    },
    startBot: async () => {},
    log: (line) => logs.push(line),
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(logs.some((line) => /boom/.test(line)))
})
