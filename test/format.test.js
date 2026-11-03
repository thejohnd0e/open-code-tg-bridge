import test from 'node:test'
import assert from 'node:assert/strict'
import { splitMessage, formatSessionList, sessionChoiceRows } from '../src/format.js'

test('короткий текст не режется', () => {
  assert.deepEqual(splitMessage('привет'), ['привет'])
})

test('длинный текст с эмодзи режется по границам, символы целы', () => {
  const text = 'Абзац с эмодзи 😀 и кириллицей. '.repeat(400)
  const parts = splitMessage(text, 4096)
  assert.ok(parts.length > 1)
  assert.ok(parts.every((p) => p.length <= 4096))
  const squash = (s) => s.replace(/\s+/g, '')
  assert.equal(parts.map(squash).join(''), squash(text))
  assert.ok(parts.every((p) => p.isWellFormed()))
})

test('текст с markdown-символами не меняется', () => {
  const t = 'a *b* _c_ `d` <e>'
  assert.equal(splitMessage(t).join(''), t)
})

test('список сессий показывает выбранную и проект', () => {
  const s = [{ id: 'ses_1', title: 'Проверка', location: { directory: 'D:\\Proj' } }]
  const out = formatSessionList(s, 'ses_1')
  assert.match(out, /Проверка/)
  assert.match(out, /Proj/)
  assert.match(out, /→/)
})

test('кнопки выбора несут id сессии в callback_data', () => {
  const rows = sessionChoiceRows([{ id: 'ses_1', title: 'Проверка' }])
  assert.equal(rows[0][0].callback_data, 'sel:ses_1')
})
