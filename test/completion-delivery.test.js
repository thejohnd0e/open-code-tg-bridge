import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompletionDelivery } from '../src/completion-delivery.js'

test('длинный итог режется по лимиту и заголовок остаётся только в первой части', async () => {
  const sent = []
  const deliver = createCompletionDelivery({ ownerID: 7, sendMessage: async (_, text) => sent.push(text) })
  const answer = 'Итоговый ответ. '.repeat(500)

  await deliver({ project: 'project-beta', title: 'Проверка', text: answer })

  assert.ok(sent.length > 1)
  assert.ok(sent.every((part) => part.length <= 4096))
  assert.match(sent[0], /^✅ Всё сделано, готово\nproject-beta · Проверка/)
  assert.equal(sent.slice(1).some((part) => part.includes('✅ Всё сделано, готово')), false)
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
