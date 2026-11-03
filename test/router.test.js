import test from 'node:test'
import assert from 'node:assert/strict'
import { isOwner, parseCommand, checkFileSize, MAX_FILE_BYTES } from '../src/router.js'

test('чужой id не владелец', () => {
  assert.equal(isOwner(42, 100500), false)
})

test('владелец опознан', () => {
  assert.equal(isOwner(100500, 100500), true)
})

test('пустой OWNER_TELEGRAM_ID не пускает никого', () => {
  assert.equal(isOwner(100500, null), false)
})

test('/sessions разбирается с аргументом', () => {
  assert.deepEqual(parseCommand('/sessions 3'), { name: 'sessions', args: '3' })
})

test('команда с упоминанием бота распознаётся', () => {
  assert.deepEqual(parseCommand('/status@ExampleBot'), { name: 'status', args: '' })
})

test('обычный текст — не команда', () => {
  assert.equal(parseCommand('привет'), null)
})

test('файл 21 МБ отклоняется с текстом про 20 МБ', () => {
  const r = checkFileSize(21 * 1024 * 1024)
  assert.equal(r.ok, false)
  assert.match(r.reason, /20 МБ/)
})

test('файл 5 МБ принимается', () => {
  assert.deepEqual(checkFileSize(5 * 1024 * 1024), { ok: true })
})

test('граница лимита включительно', () => {
  assert.deepEqual(checkFileSize(MAX_FILE_BYTES), { ok: true })
})
