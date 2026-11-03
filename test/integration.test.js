import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js')

test('мост подписывается на поток событий, даже если Telegram ещё не ответил', async () => {
  let eventStreamHit = false
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/event')) {
      eventStreamHit = true
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': heartbeat\n\n')
      return
    }
    if (req.url?.startsWith('/api/permission/request')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      TELEGRAM_BOT_TOKEN: '123456:invalid',
      OPENCODE_URL: `http://127.0.0.1:${port}`,
      OPENCODE_TOKEN: 'secret',
      OWNER_TELEGRAM_ID: '1',
      STATE_FILE: join(process.env.TEMP ?? '/tmp', `tg-int-${Date.now()}.json`),
      PORT: String(port + 1),
    },
    stdio: 'ignore',
  })

  try {
    const deadline = Date.now() + 8000
    while (!eventStreamHit && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    assert.equal(eventStreamHit, true, 'мост не подключился к /api/event')
  } finally {
    child.kill()
    await once(child, 'exit').catch(() => {})
    await new Promise((resolve) => server.close(resolve))
  }
})
