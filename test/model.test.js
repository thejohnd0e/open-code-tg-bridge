import test from 'node:test'
import assert from 'node:assert/strict'
import { recentModels, modelRows } from '../src/format.js'
import { createClient } from '../src/api.js'
import { createServer } from 'node:http'
import { createHandlers } from '../src/bot.js'

test('recentModels убирает повторы и держит порядок свежести', () => {
  const sessions = [
    { id: 'a', model: { providerID: 'opencode-go', id: 'gpt-6-luna' } },
    { id: 'b', model: { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' } },
    { id: 'c', model: { providerID: 'opencode-go', id: 'gpt-6-luna' } },
    { id: 'd', model: undefined },
  ]
  assert.deepEqual(recentModels(sessions), [
    { providerID: 'opencode-go', id: 'gpt-6-luna' },
    { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' },
  ])
})

test('кнопки моделей помечают текущую', () => {
  const models = [
    { providerID: 'opencode-go', id: 'gpt-6-luna' },
    { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' },
  ]
  const rows = modelRows(models, { providerID: 'opencode-go', id: 'gpt-6-luna' })
  assert.match(rows[0][0].text, /✓/)
  assert.equal(rows[0][0].callback_data, 'mdl:0')
  assert.equal(rows[1][0].callback_data, 'mdl:1')
})

test('switchModel шлёт провайдера и модель', async () => {
  let seen
  const server = createServer(async (req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    await new Promise((r) => req.on('end', r))
    seen = { url: req.url, method: req.method, body: JSON.parse(body) }
    res.writeHead(204).end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const client = createClient({ url: `http://127.0.0.1:${server.address().port}`, password: 'x' })
    await client.switchModel({ sessionID: 'ses_1', model: { providerID: 'opencode-go', id: 'gpt-6-luna' } })
    assert.equal(seen.url, '/api/session/ses_1/model')
    assert.equal(seen.method, 'POST')
    assert.deepEqual(seen.body, { model: { providerID: 'opencode-go', id: 'gpt-6-luna' } })
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('/model показывает клавиатуру и переключает модель по нажатию', async () => {
  const switched = []
  const client = {
    listSessions: async () => [
      { id: 'ses_1', title: 'Работа', model: { providerID: 'opencode-go', id: 'gpt-6-luna' } },
      { id: 'ses_2', title: 'Другое', model: { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' } },
    ],
    switchModel: async (args) => switched.push(args),
    prompt: async () => {},
  }
  let data = { ownerID: 1, selectedSessionID: 'ses_1' }
  const store = { get: () => data, set: (p) => (data = { ...data, ...p }), flush: async () => {} }
  const handlers = createHandlers({ client, store, config: { ownerID: 1 }, log: () => {}, files: {} })
  const replies = []
  const ctx = {
    from: { id: 1 },
    chat: { id: 1, type: 'private' },
    message: { text: '/model' },
    reply: async (body, options) => replies.push({ body, options }),
  }
  await handlers.onMessage(ctx)
  assert.match(replies[0].body, /gpt-6-luna/)
  const rows = replies[0].options.reply_markup.inline_keyboard
  assert.equal(rows.length, 2)

  const press = {
    from: { id: 1 },
    chat: { id: 1, type: 'private' },
    callbackQuery: { data: 'mdl:1' },
    answerCallbackQuery: async () => {},
    reply: async (body) => replies.push({ body }),
  }
  await handlers.onCallback(press)
  assert.deepEqual(switched[0], { sessionID: 'ses_1', model: { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' } })
})
