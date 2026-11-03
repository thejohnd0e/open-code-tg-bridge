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
    listAllSessions: async () => [{ id: 'ses_1', title: 'Проверка', location: { directory: 'D:\\Proj' } }],
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

function fakeCtx({ userID = 1, chatType = 'private', text, photo, document, caption, callback, updateID } = {}) {
  const replies = []
  return {
    replies,
    update: updateID ? { update_id: updateID } : undefined,
    from: { id: userID },
    chat: { id: chatType === 'private' ? userID : 555, type: chatType },
    message: { text, photo, document, caption },
    callbackQuery: callback ? { data: callback } : undefined,
    reply: async (body, options) => {
      replies.push({ body, options })
    },
    answerCallbackQuery: async () => {},
    editMessageReplyMarkup: async () => {},
    editMessageText: async (body, options) => replies.push({ body, options }),
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

test('владелец в группе не может отправлять команды или промпты боту', async () => {
  const client = fakeClient()
  const handlers = createHandlers({ client, store: fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' }), config, log: () => {}, files: {} })
  const ctx = fakeCtx({ userID: 1, chatType: 'supergroup', text: 'Прочитай секретный файл' })
  await handlers.onMessage(ctx)
  assert.deepEqual(ctx.replies, [])
  assert.deepEqual(client.calls.prompt, [])
})

test('владелец в группе не может нажать кнопку подтверждения', async () => {
  const client = fakeClient()
  const cards = new Map([['k1', { sessionID: 'ses_other', requestID: 'req_1' }]])
  const handlers = createHandlers({
    client,
    store: fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' }),
    config,
    log: () => {},
    files: {},
    permissionCards: cards,
  })
  const ctx = fakeCtx({ userID: 1, chatType: 'group', callback: 'perm:k1:once' })
  await handlers.onCallback(ctx)
  assert.deepEqual(client.calls.reply, [])
  assert.deepEqual(ctx.replies, [])
})

test('текст уходит в выбранную сессию', async () => {
  const client = fakeClient()
  const store = fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' })
  const handlers = createHandlers({ client, store, config, log: () => {}, files: {} })
  const ctx = fakeCtx({ text: 'привет' })
  await handlers.onMessage(ctx)
  assert.deepEqual(client.calls.prompt, [{ sessionID: 'ses_1', text: 'привет' }])
})

test('without a selected session the bot asks for /sessions in English', async () => {
  const client = fakeClient()
  const handlers = createHandlers({ client, store: fakeStore({ ownerID: 1 }), config, log: () => {}, files: {} })
  const ctx = fakeCtx({ text: 'привет' })
  await handlers.onMessage(ctx)
  assert.equal(client.calls.prompt.length, 0)
  assert.equal(ctx.replies[0].body, 'Please select a session first: /sessions')
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

test('voice transcription is sent with an English marker while transcript stays unchanged', async () => {
  const client = fakeClient()
  const files = { download: async () => ({ name: 'voice.ogg', mime: 'audio/ogg', dataBase64: 'AAA', size: 2048 }) }
  const calls = []
  const transcribe = async (args) => {
    calls.push(args)
    return 'привет мир'
  }
  const handlers = createHandlers({
    client,
    store: fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' }),
    config,
    log: () => {},
    files,
    transcribe,
  })
  const ctx = fakeCtx({})
  ctx.message.voice = { file_id: 'v1', file_size: 2048, duration: 2 }
  await handlers.onMessage(ctx)
  assert.equal(calls[0].mime, 'audio/ogg')
  assert.deepEqual(client.calls.prompt, [{ sessionID: 'ses_1', text: 'Voice message: привет мир' }])
})

test('сбой распознавания — понятная ошибка, сессия не тронута', async () => {
  const client = fakeClient()
  const files = { download: async () => ({ name: 'voice.ogg', mime: 'audio/ogg', dataBase64: 'AAA', size: 2048 }) }
  const handlers = createHandlers({
    client,
    store: fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' }),
    config,
    log: () => {},
    files,
    transcribe: async () => {
      throw new Error('whisper 500')
    },
  })
  const ctx = fakeCtx({})
  ctx.message.voice = { file_id: 'v1', file_size: 2048, duration: 2 }
  await handlers.onMessage(ctx)
  assert.equal(client.calls.prompt.length, 0)
  assert.match(ctx.replies[0].body, /speech recognition is unavailable/)
})

test('пустое распознавание не уходит в сессию', async () => {
  const client = fakeClient()
  const files = { download: async () => ({ name: 'voice.ogg', mime: 'audio/ogg', dataBase64: 'AAA', size: 2048 }) }
  const handlers = createHandlers({
    client,
    store: fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' }),
    config,
    log: () => {},
    files,
    transcribe: async () => '',
  })
  const ctx = fakeCtx({})
  ctx.message.voice = { file_id: 'v1', file_size: 2048, duration: 2 }
  await handlers.onMessage(ctx)
  assert.equal(client.calls.prompt.length, 0)
  assert.equal(ctx.replies.length, 1)
  assert.equal(ctx.replies[0].body, 'No speech was detected. Try again or type your message.')
})

test('unsupported media receives an English explanation', async () => {
  const client = fakeClient()
  const handlers = createHandlers({ client, store: fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' }), config, log: () => {}, files: {} })
  const ctx = fakeCtx({})
  ctx.message.video_note = { file_id: 'v2', duration: 4 }
  await handlers.onMessage(ctx)
  assert.equal(client.calls.prompt.length, 0)
  assert.equal(ctx.replies[0].body, 'Videos and stickers are not supported yet. Send text, a file, or a voice message instead.')
})


test('/sessions отдаёт список и клавиатуру выбора', async () => {  const client = fakeClient()
  const handlers = createHandlers({ client, store: fakeStore({ ownerID: 1 }), config, log: () => {}, files: {} })
  const ctx = fakeCtx({ text: '/sessions' })
  await handlers.onMessage(ctx)
  assert.match(ctx.replies[0].body, /Проверка/)
  assert.equal(ctx.replies[0].options.reply_markup.inline_keyboard[0][0].callback_data, 'sel:ses_1')
})

test('/sessions поддерживает страницы и переходы по всему списку', async () => {
  const client = fakeClient({
    listAllSessions: async () => Array.from({ length: 25 }, (_, i) => ({
      id: `ses_${i + 1}`,
      title: `Сессия ${i + 1}`,
      location: { directory: `D:\\Projects\\P${i + 1}` },
    })),
  })
  let state = { ownerID: 1, selectedSessionID: null }
  const store = { get: () => state, set: (patch) => (state = { ...state, ...patch }), flush: async () => {} }
  const handlers = createHandlers({ client, store, config, log: () => {}, files: {} })
  const ctx = fakeCtx({ text: '/sessions 2' })
  await handlers.onMessage(ctx)

  assert.match(ctx.replies[0].body, /Page 2 of 3/)
  assert.match(ctx.replies[0].body, /11\. Сессия 11/)
  assert.equal(ctx.replies[0].options.reply_markup.inline_keyboard[0][0].callback_data, 'sel:ses_11')
  assert.deepEqual(ctx.replies[0].options.reply_markup.inline_keyboard.at(-1).map((button) => button.callback_data), ['sp:1', 'sp:3'])

  const next = fakeCtx({ callback: 'sp:3' })
  await handlers.onCallback(next)
  assert.match(next.replies[0].body, /Page 3 of 3/)
  assert.match(next.replies[0].body, /21\. Сессия 21/)

  await handlers.onCallback(fakeCtx({ callback: 'sel:ses_11' }))
  assert.equal(state.selectedSessionID, 'ses_11')
})

test('кнопка подтверждения берёт сессию и запрос из короткой карты', async () => {
  const client = fakeClient()
  const cards = new Map([['k1', { sessionID: 'ses_other', requestID: 'req_9' }]])
  const handlers = createHandlers({
    client,
    store: fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' }),
    config,
    log: () => {},
    files: {},
    permissionCards: cards,
  })
  const ctx = fakeCtx({ callback: 'perm:k1:once' })
  await handlers.onCallback(ctx)
  assert.deepEqual(client.calls.reply, [{ sessionID: 'ses_other', requestID: 'req_9', decision: 'once' }])
  assert.equal(ctx.replies[0].body, 'Decision for req_9: once')
})

test('ошибка ответа OpenCode оставляет карточку подтверждения доступной для повтора', async () => {
  const client = fakeClient({ replyPermission: async () => { throw new Error('OpenCode unavailable') } })
  const cards = new Map([['k1', { sessionID: 'ses_other', requestID: 'req_9' }]])
  const handlers = createHandlers({
    client,
    store: fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' }),
    config,
    log: () => {},
    files: {},
    permissionCards: cards,
  })
  const ctx = fakeCtx({ callback: 'perm:k1:once' })

  await handlers.onCallback(ctx)

  assert.equal(cards.has('k1'), true)
  assert.match(ctx.replies.at(-1).body, /OpenCode server is unavailable/)
})

test('устаревшая карточка не роняет обработчик', async () => {
  const client = fakeClient()
  const handlers = createHandlers({
    client,
    store: fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' }),
    config,
    log: () => {},
    files: {},
    permissionCards: new Map(),
  })
  const ctx = fakeCtx({ callback: 'perm:gone:reject' })
  await handlers.onCallback(ctx)
  assert.equal(client.calls.reply.length, 0)
  assert.match(ctx.replies[0].body, /This approval request is stale/)
})

test('session picker callback confirms selection in English', async () => {
  const state = { ownerID: 1, selectedSessionID: null }
  const store = { get: () => state, set: (patch) => Object.assign(state, patch), flush: async () => {} }
  const handlers = createHandlers({ client: fakeClient(), store, config, log: () => {}, files: {} })
  const ctx = fakeCtx({ callback: 'sel:ses_1' })
  await handlers.onCallback(ctx)
  assert.equal(ctx.replies[0].body, 'Selected session ses_1')
})

test('status and new-session responses use English labels while preserving session data', async () => {
  const client = fakeClient({
    listSessions: async () => [{ id: 'ses_1', title: 'Русское название', location: { directory: 'D:\\Proj' } }],
    createSession: async (args) => ({ id: 'ses_new', title: args.title, location: { directory: args.directory } }),
  })
  const store = fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' })
  const handlers = createHandlers({ client, store, config, log: () => {}, files: {}, now: () => new Date('2026-11-03T15:40:00Z') })
  const status = fakeCtx({ text: '/status' })
  await handlers.onMessage(status)
  assert.match(status.replies[0].body, /^Current session:\nРусское название/)

  const fresh = fakeCtx({ text: '/new' })
  await handlers.onMessage(fresh)
  assert.match(fresh.replies[0].body, /^Created lightweight session /)
})

test('model picker prompts in English and preserves model identifiers', async () => {
  const client = fakeClient({
    listSessions: async () => [{ id: 'ses_1', title: 'Model sample', model: { providerID: 'provider', id: 'model-a' } }],
  })
  const handlers = createHandlers({ client, store: fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' }), config, log: () => {}, files: {} })
  const ctx = fakeCtx({ text: '/model' })
  await handlers.onMessage(ctx)
  assert.equal(ctx.replies[0].body, 'Current session model: provider/model-a\nChoose a model:')
})

test('повторный update_id не выполняет команду дважды', async () => {
  const client = fakeClient()
  const handlers = createHandlers({
    client,
    store: fakeStore({ ownerID: 1, selectedSessionID: 'ses_1' }),
    config,
    log: () => {},
    files: {},
  })
  await handlers.onMessage(fakeCtx({ text: 'привет', updateID: 77 }))
  await handlers.onMessage(fakeCtx({ text: 'привет', updateID: 77 }))
  assert.equal(client.calls.prompt.length, 1)
})

