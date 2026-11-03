import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../src/state.js'

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'tg-state-')), 'state.json')

test('set сохраняет поля и читается после перезагрузки', async () => {
  const f = tmpFile()
  const s = createStore(f, { ownerID: null, selectedSessionID: null })
  s.set({ selectedSessionID: 'ses_1' })
  await s.flush()
  assert.equal(createStore(f, {}).get().selectedSessionID, 'ses_1')
})

test('битый файл не роняет старт', () => {
  const f = tmpFile()
  writeFileSync(f, '{oops')
  assert.equal(createStore(f, { ownerID: null }).get().ownerID, null)
})
