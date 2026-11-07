import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const entry = resolve('src/index.js')

test('startup loads .env from the current directory', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bridge-env-'))
  try {
    writeFileSync(join(cwd, '.env'), 'TELEGRAM_BOT_TOKEN=example\n')
    const env = { ...process.env }
    delete env.TELEGRAM_BOT_TOKEN
    delete env.OPENCODE_URL
    const result = spawnSync(process.execPath, [entry], { cwd, env, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /missing env OPENCODE_URL/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('existing environment takes precedence over .env', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bridge-env-'))
  try {
    writeFileSync(join(cwd, '.env'), 'TELEGRAM_BOT_TOKEN=example\n')
    const result = spawnSync(process.execPath, [entry], { cwd, env: { ...process.env, TELEGRAM_BOT_TOKEN: '' }, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /missing env TELEGRAM_BOT_TOKEN/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
