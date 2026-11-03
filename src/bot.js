import { Bot } from 'grammy'
import { isOwner, parseCommand, checkFileSize } from './router.js'
import { formatSessionList, sessionChoiceRows, sessionNavigationRows, splitMessage, sessionTitle, recentModels, modelRows } from './format.js'
import { pollPermissionCards } from './permissions.js'

const NO_SESSION = 'Сначала выберите сессию: /sessions'
const SERVER_DOWN = 'Сервер OpenCode недоступен — попробуйте позже.'
const SESSION_PAGE_SIZE = 10
const REPLY_KEYBOARD = {
  keyboard: [
    [{ text: 'Сессии' }, { text: 'Новая' }],
    [{ text: 'Модель' }, { text: 'Статус' }, { text: 'Помощь' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  one_time_keyboard: false,
}

function parseModel(model) {
  if (!model) return undefined
  const [providerID, id] = model.split('/')
  return { providerID, id }
}

function pickFile(message) {
  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1]
    return { fileID: largest.file_id, size: largest.file_size ?? 0, name: 'photo.jpg', mime: 'image/jpeg' }
  }
  if (message.document) {
    return {
      fileID: message.document.file_id,
      size: message.document.file_size ?? 0,
      name: message.document.file_name ?? 'file.bin',
      mime: message.document.mime_type ?? 'application/octet-stream',
    }
  }
  return null
}

export function createHandlers({ client, store, config, log = () => {}, files, transcribe, permissionCards = new Map(), now = () => new Date() }) {
  const selected = () => store.get().selectedSessionID
  const owner = () => config.ownerID ?? store.get().ownerID
  let modelChoices = []

  async function guarded(ctx, action) {
    const chat = ctx.chat ?? ctx.callbackQuery?.message?.chat
    if (!isOwner(ctx.from?.id, owner()) || chat?.type !== 'private' || !isOwner(chat?.id, owner())) {
      log(`unauthorized user_id=${ctx.from?.id} chat_id=${chat?.id} chat_type=${chat?.type}`)
      return
    }
    const updateID = ctx.update?.update_id
    if (updateID && store.get().updateID >= updateID) {
      log(`skip duplicate update_id=${updateID}`)
      return
    }
    if (updateID) {
      store.set({ updateID })
      store.flush().catch(() => {})
    }
    try {
      await action()
    } catch (error) {
      log(`handler failed: ${error.message}`)
      await ctx.reply(SERVER_DOWN).catch(() => {})
    }
  }

  async function onStart(ctx) {
    const id = selected()
    await ctx.reply(
      id ? `На связи. Текущая сессия: ${id}` : 'На связи. Сессию ещё не выбрали: /sessions',
      { reply_markup: REPLY_KEYBOARD },
    )
  }

  async function showSessions(ctx, requestedPage = 1, { edit = false } = {}) {
    const sessions = await client.listAllSessions()
    const id = selected()
    const pages = Math.max(1, Math.ceil(sessions.length / SESSION_PAGE_SIZE))
    const page = Math.min(pages, Math.max(1, Number.isInteger(requestedPage) ? requestedPage : 1))
    const text = formatSessionList(sessions, id, SESSION_PAGE_SIZE, page)
    const inline_keyboard = [
      ...sessionChoiceRows(sessions, SESSION_PAGE_SIZE, page),
      ...sessionNavigationRows(sessions, page, SESSION_PAGE_SIZE),
    ]
    const options = { reply_markup: { inline_keyboard } }
    if (edit) return ctx.editMessageText(text, options)
    return ctx.reply(text, options)
  }

  async function onSessions(ctx, args = '') {
    const requestedPage = Number(args.trim())
    return showSessions(ctx, Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1)
  }

  async function onStatus(ctx) {
    const id = selected()
    if (!id) return ctx.reply('Сессия не выбрана. /sessions')
    const sessions = await client.listSessions({ limit: 20 })
    const session = (sessions ?? []).find((s) => s.id === id)
    if (!session) return ctx.reply(`Выбрана сессия ${id} (в последних 20 не видна)`)
    await ctx.reply(`${session.title || '(без названия)'}\n${session.location?.directory ?? ''}\n${session.id}`)
  }

  async function onNew(ctx) {
    const session = await client.createSession({
      directory: config.lightDir,
      title: sessionTitle(now(), config.timeZone),
      model: parseModel(config.lightModel),
    })
    store.set({ selectedSessionID: session.id })
    await store.flush()
    await ctx.reply(`Создана лёгкая сессия «${session.title ?? session.id}» в ${config.lightDir}`)
  }

  async function onHelp(ctx) {
    await ctx.reply(
      [
        '/sessions — выбрать сессию любого проекта',
        '/status — что выбрано сейчас',
        '/new — лёгкая сессия для быстрых вопросов',
        '/model — сменить модель выбранной сессии',
        '/help — эта справка',
        '',
        'Текст, фото, документ или голосовое — уйдёт в выбранную сессию.',
        'Ответы приходят сюда; длинные делятся на части.',
        'Запросы подтверждения приходят карточкой с кнопками «Разрешить / Всегда / Запретить».',
        '',
        'Файлы больше 20 МБ Telegram боту не отдаёт.',
      ].join('\n'),
      { reply_markup: REPLY_KEYBOARD },
    )
  }

  async function onText(ctx) {
    const command = parseCommand(ctx.message.text)
    if (command) {
      switch (command.name) {
        case 'start':
          return onStart(ctx)
        case 'sessions':
          return onSessions(ctx, command.args)
        case 'status':
          return onStatus(ctx)
        case 'new':
          return onNew(ctx)
        case 'model':
          return onModel(ctx)
        case 'help':
          return onHelp(ctx)
        default:
          return ctx.reply('Не знаю такой команды. /help')
      }
    }
    const id = selected()
    if (!id) return ctx.reply(NO_SESSION)
    await client.prompt({ sessionID: id, text: ctx.message.text })
    await ctx.reply('↗ отправлено')
  }

  async function onFile(ctx) {
    const id = selected()
    const ref = pickFile(ctx.message)
    if (!id) return ctx.reply(NO_SESSION)
    const limit = checkFileSize(ref.size)
    if (!limit.ok) return ctx.reply(limit.reason)
    const file = await files.download(ref)
    await client.prompt({ sessionID: id, text: ctx.message.caption ?? '', files: [file] })
    await ctx.reply(`↗ ${file.name} (${Math.round(file.size / 1024)} КБ) отправлен`)
  }

  async function onVoice(ctx) {
    const id = selected()
    if (!id) return ctx.reply(NO_SESSION)
    const message = ctx.message
    const ref = message.voice
      ? { fileID: message.voice.file_id, size: message.voice.file_size ?? 0, name: 'voice.ogg', mime: message.voice.mime_type ?? 'audio/ogg' }
      : { fileID: message.audio.file_id, size: message.audio.file_size ?? 0, name: message.audio.file_name ?? 'audio.mp3', mime: message.audio.mime_type ?? 'audio/mpeg' }
    const limit = checkFileSize(ref.size)
    if (!limit.ok) return ctx.reply(limit.reason)
    const file = await files.download(ref)
    let text
    try {
      text = await transcribe({ dataBase64: file.dataBase64, mime: ref.mime, name: ref.name })
    } catch (error) {
      log(`transcribe failed: ${error.message}`)
      return ctx.reply('Не разобрал голосовое: сервис распознавания недоступен. Напишите текстом или попробуйте позже.')
    }
    if (!text) return ctx.reply('Не разобрал речь в голосовом — попробуйте ещё раз или напишите текстом.')
    await client.prompt({ sessionID: id, text: `голосовое: ${text}` })
    await ctx.reply(`↗ «${text.slice(0, 300)}»`)
  }

  async function onModel(ctx) {
    const id = selected()
    if (!id) return ctx.reply(NO_SESSION)
    const sessions = await client.listSessions({ limit: 30 })
    const models = recentModels(sessions)
    if (!models.length) return ctx.reply('Не нашёл ни одной модели в недавних сессиях.')
    modelChoices = models
    const current = (sessions ?? []).find((s) => s.id === id)?.model
    const label = current ? `${current.providerID}/${current.id}` : 'неизвестна'
    await ctx.reply(`Текущая модель сессии: ${label}\nВыберите модель:`, {
      reply_markup: { inline_keyboard: modelRows(models, current) },
    })
  }

  async function onMessage(ctx) {
    await guarded(ctx, async () => {
      const message = ctx.message ?? {}
      if (message.voice || message.audio) return onVoice(ctx)
      if (message.photo || message.document) return onFile(ctx)
      if (typeof message.text === 'string') return onText(ctx)
      return ctx.reply('Видео и стикеры пока не поддерживаю — напишите текстом, пришлите файлом или голосовым.')
    })
  }

  async function onCallback(ctx) {
    await guarded(ctx, async () => {
      const data = ctx.callbackQuery?.data ?? ''
      const parts = data.split(':')
      await ctx.answerCallbackQuery().catch(() => {})
      if (parts[0] === 'sp') {
        const page = Number(parts[1])
        return showSessions(ctx, Number.isInteger(page) && page > 0 ? page : 1, { edit: true })
      }
      if (parts[0] === 'sel' && parts[1]) {
        store.set({ selectedSessionID: parts[1] })
        await store.flush()
        return ctx.reply(`Выбрана сессия ${parts[1]}`)
      }
      if (parts[0] === 'mdl') {
        const model = modelChoices[Number(parts[1])]
        if (!model) return ctx.reply('Выбор устарел: откройте /model заново.')
        const sessionID = selected()
        if (!sessionID) return ctx.reply(NO_SESSION)
        await client.switchModel({ sessionID, model })
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {})
        return ctx.reply(`Модель сессии теперь ${model.providerID}/${model.id}`)
      }
      if (parts[0] === 'perm') {
        const card = permissionCards.get(parts[1])
        if (!card) {
          await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {})
          return ctx.reply('Карточка устарела: этот запрос уже неактуален.')
        }
        const decision = parts[2]
        await client.replyPermission({ sessionID: card.sessionID, requestID: card.requestID, decision })
        permissionCards.delete(parts[1])
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {})
        return ctx.reply(`Решение по ${card.requestID}: ${decision}`)
      }
    })
  }

  return { onMessage, onCallback, onStart, onSessions, onStatus, onNew, onText, onFile }
}

function telegramFiles(bot, token) {
  return {
    async download(ref) {
      const file = await bot.api.getFile(ref.fileID)
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`)
      if (!res.ok) throw new Error(`Telegram download failed: ${res.status}`)
      const buffer = Buffer.from(await res.arrayBuffer())
      return {
        name: ref.name,
        mime: ref.mime,
        dataBase64: buffer.toString('base64'),
        size: buffer.length,
      }
    },
  }
}

export function createBot({ token, client, store, config, log = () => {}, pollMs = 3000, transcribe }) {
  const bot = new Bot(token)
  const permissionCards = new Map()
  const keySeq = { value: 0 }
  const handlers = createHandlers({
    client,
    store,
    config,
    log,
    transcribe,
    permissionCards,
    files: telegramFiles(bot, token),
  })
  const seen = new Set()
  let poller = null

  bot.on('message', (ctx) => handlers.onMessage(ctx))
  bot.on('callback_query', (ctx) => handlers.onCallback(ctx))

  async function pollPermissions() {
    return pollPermissionCards({
      client,
      ownerID: config.ownerID,
      cards: permissionCards,
      seen,
      keySeq,
      log,
      sendMessage: (chatID, text, options) => bot.api.sendMessage(chatID, text, options),
    })
  }

  async function start() {
    poller = setInterval(() => pollPermissions().catch(() => {}), pollMs)
    poller.unref?.()
    try {
      await bot.api.setMyCommands([
        { command: 'sessions', description: 'выбрать сессию любого проекта' },
        { command: 'status', description: 'что выбрано сейчас' },
        { command: 'new', description: 'лёгкая сессия для быстрых вопросов' },
        { command: 'model', description: 'сменить модель сессии' },
        { command: 'help', description: 'справка' },
      ])
    } catch (error) {
      log(`setMyCommands failed: ${error.message}`)
    }
    await bot.start({ onStart: (info) => log(`bot @${info.username} started`) })
  }

  async function stop() {
    if (poller) clearInterval(poller)
    await bot.stop()
  }

  return { bot, handlers, start, stop, pollPermissions }
}

export { splitMessage }




