import test from 'node:test'
import assert from 'node:assert/strict'
import { buildConfig } from '../src/config.js'

test('uses a portable working-directory default for lightweight sessions', () => {
  assert.equal(buildConfig({}).lightDir, process.cwd())
})

test('uses the locally configured lightweight-session directory', () => {
  assert.equal(buildConfig({ LIGHT_DIR: 'C:/Example/Project' }).lightDir, 'C:/Example/Project')
})
