import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '../src/api.js'
import { createCompletionTracker } from '../src/completions.js'
import { createCompletionDelivery } from '../src/completion-delivery.js'

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

test('итоги из двух сессий приходят после success, а промежуточный текст игнорируется', async () => {
  const sessions = [
    { id: 's1', title: 'Ping check', location: { directory: 'C:/Example/project-alpha' } },
    { id: 's2', title: 'Проверка роутера', location: { directory: 'C:/Example/project-beta' } },
  ]
  const histories = {
    s1: [{ id: 'old-1', type: 'idle', outcome: 'succeeded', time: { created: Date.now() - 5000 } }],
    s2: [{ id: 'old-2', type: 'idle', outcome: 'succeeded', time: { created: Date.now() - 5000 } }],
  }
  const sent = []
  let releaseSent
  const sentBoth = new Promise((resolve) => (releaseSent = resolve))
  let response

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/api/event') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      response = res
      res.write(`data: ${JSON.stringify({ id: 'connected', type: 'server.connected', data: {} })}\n\n`)
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({ id: 'progress', type: 'session.text.ended', created: Date.now(), data: { sessionID: 's1', assistantMessageID: 'progress', text: 'Сейчас проверю файл.' } })}\n\n`)
        for (const [index, sessionID] of ['s1', 's2'].entries()) {
          const created = Date.now() + index
          histories[sessionID].push(
            { id: `answer-${sessionID}`, type: 'assistant', time: { created }, content: [{ type: 'text', text: `Готово в ${sessionID}.` }] },
            { id: `idle-${sessionID}`, type: 'idle', outcome: 'succeeded', time: { created: created + 1 } },
          )
          res.write(`data: ${JSON.stringify({ id: `success-${sessionID}`, type: 'session.execution.succeeded', created: created + 2, data: { sessionID } })}\n\n`)
        }
        setTimeout(() => res.end(), 10)
      }, 20)
      return
    }
    if (url.pathname === '/api/session') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: sessions, cursor: { next: null, previous: null } }))
      return
    }
    const match = url.pathname.match(/^\/api\/session\/([^/]+)\/message$/)
    if (match) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: histories[match[1]] ?? [], cursor: { next: null, previous: null } }))
      return
    }
    if (url.pathname === '/api/session/active') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":{}}')
      return
    }
    res.writeHead(404).end()
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const client = createClient({ url: `http://127.0.0.1:${server.address().port}`, password: 'test' })
  const store = {
    data: {},
    get() { return this.data },
    set(patch) { this.data = { ...this.data, ...patch } },
    async flush() {},
  }
  const delivery = createCompletionDelivery({
    ownerID: 'owner-1',
    sendMessage: async (ownerID, text) => {
      sent.push({ ownerID, text })
      if (sent.length === 2) releaseSent()
    },
  })
  const tracker = createCompletionTracker({ client, store, onComplete: delivery })
  const running = tracker.start()
  let timeout

  try {
    await Promise.race([
      sentBoth,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('итоговые уведомления не пришли')), 5000) }),
    ])
    assert.equal(sent.length, 2)
    assert.ok(sent.some((item) => item.ownerID === 'owner-1' && item.text.includes('project-alpha · Ping check') && item.text.includes('Готово в s1.')))
    assert.ok(sent.some((item) => item.ownerID === 'owner-1' && item.text.includes('project-beta · Проверка роутера') && item.text.includes('Готово в s2.')))
    assert.ok(sent.every((item) => item.text.startsWith('✅ Всё сделано, готово')))
    assert.ok(sent.every((item) => !item.text.includes('Сейчас проверю файл.')))
  } finally {
    clearTimeout(timeout)
    tracker.stop()
    await running
    if (response && !response.writableEnded) response.end()
    await new Promise((resolve) => server.close(resolve))
  }
})
