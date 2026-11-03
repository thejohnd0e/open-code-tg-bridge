import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompletionDelivery } from '../src/completion-delivery.js'

test('длинный итог режется по лимиту и заголовок остаётся только в первой части', async () => {
  const sent = []
  const deliver = createCompletionDelivery({ ownerID: 7, sendMessage: async (_, text) => sent.push(text) })
  const answer = 'Итоговый ответ. '.repeat(500)

  await deliver({ sessionID: 'ses_1', completionID: 'idle_1', project: 'project-beta', title: 'Проверка', text: answer })

  assert.ok(sent.length > 1)
  assert.ok(sent.every((part) => part.length <= 4096))
  assert.match(sent[0], /^✅ All done\nproject-beta · Проверка/)
  assert.equal(sent.slice(1).some((part) => part.includes('✅ All done')), false)
  assert.ok(sent.join('').includes(answer))
})

test('без owner id completion не отправляется', async () => {
  const sent = []
  const logs = []
  const deliver = createCompletionDelivery({ ownerID: null, sendMessage: async (...args) => sent.push(args), log: (line) => logs.push(line) })
  await deliver({ project: 'p', title: 's', text: 'done' })
  assert.deepEqual(sent, [])
  assert.ok(logs.some((line) => /OWNER_TELEGRAM_ID/.test(line)))
})

test('после доставки итог оставляет диагностическую строку', async () => {
  const logs = []
  const deliver = createCompletionDelivery({ ownerID: 7, sendMessage: async () => {}, log: (line) => logs.push(line) })
  await deliver({ sessionID: 'ses_1', completionID: 'idle_1', project: 'Demo', title: 'Проверка', text: 'Готово' })
  assert.ok(logs.some((line) => /completion delivered ses_1 idle_1/.test(line)))
})

test('повтор частично отправленного итога продолжает со следующей части', async () => {
  let data = {}
  const store = { get: () => data, set: (patch) => (data = { ...data, ...patch }), flush: async () => {} }
  const sent = []
  let failSecond = true
  const completion = { sessionID: 'ses_1', completionID: 'idle_1', project: 'Demo', title: 'Проверка', text: 'Итоговый ответ. '.repeat(500) }
  const sendMessage = async (_, text) => {
    if (failSecond && sent.length === 1) throw new Error('Telegram temporarily unavailable')
    sent.push(text)
  }
  const firstDelivery = createCompletionDelivery({ ownerID: 7, sendMessage, store })

  await assert.rejects(() => firstDelivery(completion), /temporarily unavailable/)
  assert.equal(sent.length, 1)
  assert.equal(store.get().completionDeliveryParts.ses_1.nextPart, 1)

  failSecond = false
  const retryDelivery = createCompletionDelivery({ ownerID: 7, sendMessage, store })
  await retryDelivery(completion)

  assert.equal(sent.length, 3)
  assert.equal(sent[0].startsWith('✅ All done'), true)
  assert.equal(sent.slice(1).some((part) => part.includes('✅ All done')), false)
})
