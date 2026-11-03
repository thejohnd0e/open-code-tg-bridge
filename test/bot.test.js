import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandlers } from '../src/bot.js'

function fakeStore(initial = {}) {
  let data = { ownerID: null, selectedSessionID: null, ...initial }
  return { get: () => data, set: (patch) => (data = { ...data, ...patch }), flush: async () => {} }
}

function fakeClient(overrides = {}) {
  const calls = { prompt: [], list: 0, reply: [], created: [] }
  return {
    calls,
    listSessions: async () => {
      calls.list += 1
      return [{ id: 'ses_1', title: 'Проверка', location: { directory: 'D:\\Proj' } }]
    },
    prompt: async (args) => calls.prompt.push(args),
    createSession: async (args) => {
      calls.created.push(args)
      return { id: 'ses_new', title: args.title, location: { directory: args.directory } }
    },
    replyPermission: async (args) => calls.reply.push(args),
    pendingPermissions: async () => [],
    messages: async () => [],
    ...overrides,
  }
}

function fakeCtx({ userID = 1, text, photo, document, caption, callback } = {}) {
  const replies = []
  return {
    replies,
    from: { id: userID },
    chat: { id: 555 },
    message: { text, photo, document, caption },
    callbackQuery: callback ? { data: callback } : undefined,
    reply: async (body, options) => {
      replies.push({ body, options })
    },
    answerCallbackQuery: async () => {},
    editMessageReplyMarkup: async () => {},
  }
}

const config = { ownerID: 1, lightDir: 'C:/Example/Project', lightModel: 'opencode-go/gpt-6-luna' }

test('чужой пользователь не получает ответа и не попадает в API', async () => {
  const client = fakeClient()
  const handlers = createHandlers({ client, store: fakeStore(), config, log: () => {}, files: {} })
  const ctx = fakeCtx({ userID: 42, text: 'привет' })
  await handlers.onMessage(ctx)
  assert.deepEqual(ctx.replies, [])
  assert.equal(client.calls.prompt.length, 0)
  assert.equal(client.calls.list, 0)
})

test('текст уходит в выбранную сессию', async () => {
  const client = fakeClient()
  const store = fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' })
  const handlers = createHandlers({ client, store, config, log: () => {}, files: {} })
  const ctx = fakeCtx({ text: 'привет' })
  await handlers.onMessage(ctx)
  assert.deepEqual(client.calls.prompt, [{ sessionID: 'ses_1', text: 'привет' }])
})

test('без выбранной сессии текст просит /sessions', async () => {
  const client = fakeClient()
  const handlers = createHandlers({ client, store: fakeStore({ ownerID: 1 }), config, log: () => {}, files: {} })
  const ctx = fakeCtx({ text: 'привет' })
  await handlers.onMessage(ctx)
  assert.equal(client.calls.prompt.length, 0)
  assert.match(ctx.replies[0].body, /\/sessions/)
})

test('фото скачивается и уходит файлом с mime', async () => {
  const client = fakeClient()
  const files = {
    download: async () => ({ name: 'photo.jpg', mime: 'image/jpeg', dataBase64: 'AAA', size: 1024 }),
  }
  const handlers = createHandlers({
    client,
    store: fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' }),
    config,
    log: () => {},
    files,
  })
  const ctx = fakeCtx({
    photo: [
      { file_id: 'small', file_size: 10, width: 10 },
      { file_id: 'big', file_size: 1024, width: 1280 },
    ],
    caption: 'смотри',
  })
  await handlers.onMessage(ctx)
  assert.equal(client.calls.prompt.length, 1)
  assert.equal(client.calls.prompt[0].files[0].mime, 'image/jpeg')
  assert.equal(client.calls.prompt[0].text, 'смотри')
})

test('голосовое сообщение получает понятный отказ, а не тишину', async () => {
  const client = fakeClient()
  const handlers = createHandlers({ client, store: fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' }), config, log: () => {}, files: {} })
  const ctx = fakeCtx({})
  ctx.message.voice = { file_id: 'v1', duration: 3, file_size: 20000 }
  await handlers.onMessage(ctx)
  assert.equal(client.calls.prompt.length, 0)
  assert.match(ctx.replies[0].body, /[Гг]олосов/)
})

test('стикер и видео тоже не проваливаются в тишину', async () => {
  const client = fakeClient()
  const handlers = createHandlers({ client, store: fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' }), config, log: () => {}, files: {} })
  const ctx = fakeCtx({})
  ctx.message.video_note = { file_id: 'v2', duration: 4 }
  await handlers.onMessage(ctx)
  assert.equal(client.calls.prompt.length, 0)
  assert.equal(ctx.replies.length, 1)
})

test('кнопка reject шлёт replyPermission reject', async () => {
  const client = fakeClient()
  const handlers = createHandlers({ client, store: fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' }), config, log: () => {}, files: {} })
  const ctx = fakeCtx({ callback: 'perm:req_1:reject' })
  await handlers.onCallback(ctx)
  assert.deepEqual(client.calls.reply, [{ sessionID: 'ses_1', requestID: 'req_1', reply: 'reject' }])
})

test('/sessions отдаёт список и клавиатуру выбора', async () => {
  const client = fakeClient()
  const handlers = createHandlers({ client, store: fakeStore({ ownerID: 1 }), config, log: () => {}, files: {} })
  const ctx = fakeCtx({ text: '/sessions' })
  await handlers.onMessage(ctx)
  assert.match(ctx.replies[0].body, /Проверка/)
  assert.equal(ctx.replies[0].options.reply_markup.inline_keyboard[0][0].callback_data, 'sel:ses_1')
})
