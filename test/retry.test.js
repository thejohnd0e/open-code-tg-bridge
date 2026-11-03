import test from 'node:test'
import assert from 'node:assert/strict'
import { startWithRetry } from '../src/retry.js'

test('падение старта логируется и повторяется по таймеру', async () => {
  const logs = []
  const timers = []
  await startWithRetry(async () => {
    throw new Error('401 Unauthorized')
  }, { log: (line) => logs.push(line), delayMs: 5000, setTimeoutImpl: (fn, ms) => timers.push({ fn, ms }) })
  assert.match(logs[0], /401 Unauthorized/)
  assert.equal(timers.length, 1)
  assert.equal(timers[0].ms, 5000)
})

test('успешный старт не планирует повтор', async () => {
  const timers = []
  await startWithRetry(async () => {}, { log: () => {}, setTimeoutImpl: (fn, ms) => timers.push({ fn, ms }) })
  assert.equal(timers.length, 0)
})
