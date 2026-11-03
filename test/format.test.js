import test from 'node:test'
import assert from 'node:assert/strict'
import { splitMessage, formatSessionList, sessionChoiceRows, permissionCardText } from '../src/format.js'

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

test('карточка подтверждения называет проект и сессию', () => {
  const text = permissionCardText(
    { action: 'bash', resources: ['rm -rf /tmp/x'], message: 'Требуется подтверждение' },
    { title: 'Проверка связей', location: { directory: 'C:/Example/project-beta' } },
  )
  assert.match(text, /bash/)
  assert.match(text, /rm -rf \/tmp\/x/)
  assert.match(text, /Проверка связей/)
  assert.match(text, /project-beta/)
})

test('без данных сессии карточка всё равно собирается', () => {
  const text = permissionCardText({ action: 'edit', resources: [] }, undefined)
  assert.match(text, /edit/)
})
