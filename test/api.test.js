import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createClient } from '../src/api.js'

async function withServer(handler, fn) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => resolve(body))
  })
}

function json(res, payload, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

test('prompt упаковывает файл в data-uri и шлёт Basic-авторизацию', async () => {
  let seen
  await withServer(
    async (req, res) => {
      seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(await readBody(req)) }
      json(res, { data: { id: 'msg_1' } })
    },
    async (url) => {
      const client = createClient({ url, password: 'secret' })
      await client.prompt({
        sessionID: 'ses_1',
        text: 'hi',
        files: [{ name: 'a.png', mime: 'image/png', dataBase64: 'AAA' }],
      })
      assert.equal(seen.url, '/api/session/ses_1/prompt')
      assert.equal(seen.auth, `Basic ${Buffer.from('opencode:secret').toString('base64')}`)
      assert.equal(seen.body.text, 'hi')
      assert.equal(seen.body.files[0].uri, 'data:image/png;base64,AAA')
      assert.deepEqual(seen.body.files[0].source, { type: 'inline' })
      assert.equal(seen.body.files[0].name, 'a.png')
    },
  )
})

test('replyPermission шлёт решение reject', async () => {
  let seen
  await withServer(
    async (req, res) => {
      seen = { url: req.url, body: JSON.parse(await readBody(req)) }
      res.writeHead(204).end()
    },
    async (url) => {
      const client = createClient({ url, password: 'x' })
      await client.replyPermission({ sessionID: 'ses_1', requestID: 'req_1', decision: 'reject' })
      assert.equal(seen.url, '/api/session/ses_1/permission/req_1/reply')
      assert.deepEqual(seen.body, { decision: 'reject' })
    },
  )
})

test('401 превращается в понятную ошибку', async () => {
  await withServer(
    (req, res) => json(res, {}, 401),
    async (url) => {
      const client = createClient({ url, password: 'x' })
      await assert.rejects(() => client.listSessions(), /авторизац/)
    },
  )
})

test('eventStream отдаёт события и пропускает heartbeat', async () => {  await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': heartbeat\n\ndata: {"id":"e1","type":"session.text.delta","data":{"delta":"a"}}\n\n')
      res.end()
    },
    async (url) => {
      const client = createClient({ url, password: 'x' })
      const events = []
      await client.eventStream({ onEvent: (e) => events.push(e) })
      assert.equal(events.length, 1)
      assert.equal(events[0].type, 'session.text.delta')
      assert.equal(events[0].data.delta, 'a')
    },
  )
})

test('activeSessions возвращает список id из карты', async () => {
  await withServer(
    (req, res) => json(res, { data: { ses_a: { type: 'running' }, ses_b: { type: 'running' } } }),
    async (url) => {
      const client = createClient({ url, password: 'x' })
      assert.deepEqual(await client.activeSessions(), ['ses_a', 'ses_b'])
    },
  )
})

test('sessionPermissions спрашивает список подтверждений конкретной сессии', async () => {
  let seen
  await withServer(
    (req, res) => {
      seen = req.url
      json(res, { data: [{ id: 'per_1', sessionID: 'ses_a', action: 'shell', resources: ['whoami'] }] })
    },
    async (url) => {
      const client = createClient({ url, password: 'x' })
      const list = await client.sessionPermissions('ses_a')
      assert.equal(seen, '/api/session/ses_a/permission')
      assert.equal(list[0].id, 'per_1')
    },
  )
})

