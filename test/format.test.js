import test from 'node:test'
import assert from 'node:assert/strict'
import { splitMessage, formatSessionList, sessionChoiceRows, permissionCardText, sessionNavigationRows } from '../src/format.js'

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

test('session list labels are English and original session title remains unchanged', () => {
  const s = [{ id: 'ses_1', title: 'Проверка', location: { directory: 'D:\\Proj' } }]
  const out = formatSessionList(s, 'ses_1')
  assert.match(out, /Проверка/)
  assert.match(out, /Proj/)
  assert.match(out, /Sessions — Page 1 of 1/)
  assert.match(out, /→/)
})

test('кнопки выбора несут id сессии в callback_data', () => {
  const rows = sessionChoiceRows([{ id: 'ses_1', title: 'Проверка' }])
  assert.equal(rows[0][0].callback_data, 'sel:ses_1')
})

test('permission card labels are English and preserve action/session data', () => {
  const text = permissionCardText(
    { action: 'bash', resources: ['rm -rf /tmp/x'], message: 'Требуется подтверждение' },
    { title: 'Проверка связей', location: { directory: 'C:/Example/project-beta' } },
  )
  assert.match(text, /bash/)
  assert.match(text, /rm -rf \/tmp\/x/)
  assert.match(text, /Approval required: bash/)
  assert.match(text, /Session: Проверка связей/)
  assert.match(text, /project-beta/)
})

test('без данных сессии карточка всё равно собирается', () => {
  const text = permissionCardText({ action: 'edit', resources: [] }, undefined)
  assert.match(text, /edit/)
})

test('empty session list uses English copy', () => {
  assert.equal(formatSessionList([], null), 'No sessions found.')
})

test('страница списка сессий показывает записи и кнопки навигации для всего списка', () => {
  const sessions = Array.from({ length: 25 }, (_, i) => ({ id: `ses_${i + 1}`, title: `Сессия ${i + 1}`, location: { directory: `D:\\Projects\\P${i + 1}` } }))
  const page = 2
  const text = formatSessionList(sessions, 'ses_11', 10, page)
  const choices = sessionChoiceRows(sessions, 10, page)
  const navigation = sessionNavigationRows(sessions, page, 10)

  assert.match(text, /11\. Сессия 11/)
  assert.doesNotMatch(text, /Сессия 1\n/)
  assert.match(text, /Page 2 of 3/)
  assert.equal(choices.length, 10)
  assert.equal(choices[0][0].callback_data, 'sel:ses_11')
  assert.deepEqual(navigation[0], [
    { text: '‹ Previous', callback_data: 'sp:1' },
    { text: 'Next ›', callback_data: 'sp:3' },
  ])
})
