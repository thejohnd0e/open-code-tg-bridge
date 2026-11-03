import { Bot } from 'grammy'
import { isOwner, parseCommand, checkFileSize } from './router.js'
import { formatSessionList, sessionChoiceRows, splitMessage } from './format.js'

const NO_SESSION = 'Сначала выберите сессию: /sessions'
const SERVER_DOWN = 'Сервер OpenCode недоступен — попробуйте позже.'

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

export function createHandlers({ client, store, config, log = () => {}, files, onSelect = () => {} }) {
  const selected = () => store.get().selectedSessionID
  const owner = () => config.ownerID ?? store.get().ownerID

  async function guarded(ctx, action) {
    if (!isOwner(ctx.from?.id, owner())) {
      log(`unauthorized user_id=${ctx.from?.id}`)
      return
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
    await ctx.reply(id ? `На связи. Текущая сессия: ${id}` : 'На связи. Сессию ещё не выбрали: /sessions')
  }

  async function onSessions(ctx) {
    const sessions = await client.listSessions({ limit: 20 })
    const id = selected()
    await ctx.reply(formatSessionList(sessions, id), {
      reply_markup: { inline_keyboard: sessionChoiceRows(sessions) },
    })
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
      title: 'Telegram',
      model: parseModel(config.lightModel),
    })
    store.set({ selectedSessionID: session.id, lastMirrored: null })
    await store.flush()
    onSelect(session.id)
    await ctx.reply(`Создана лёгкая сессия ${session.id} в ${config.lightDir}`)
  }

  async function onHelp(ctx) {
    await ctx.reply(
      [
        '/sessions — выбрать сессию любого проекта',
        '/status — что выбрано сейчас',
        '/new — лёгкая сессия для быстрых вопросов',
        'Просто текст, фото или файл — уйдёт в выбранную сессию.',
      ].join('\n'),
    )
  }

  async function onText(ctx) {
    const command = parseCommand(ctx.message.text)
    if (command) {
      switch (command.name) {
        case 'start':
          return onStart(ctx)
        case 'sessions':
          return onSessions(ctx)
        case 'status':
          return onStatus(ctx)
        case 'new':
          return onNew(ctx)
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

  async function onMessage(ctx) {
    await guarded(ctx, async () => {
      if (ctx.message?.photo || ctx.message?.document) return onFile(ctx)
      if (typeof ctx.message?.text === 'string') return onText(ctx)
    })
  }

  async function onCallback(ctx) {
    await guarded(ctx, async () => {
      const data = ctx.callbackQuery?.data ?? ''
      const parts = data.split(':')
      await ctx.answerCallbackQuery().catch(() => {})
      if (parts[0] === 'sel' && parts[1]) {
        store.set({ selectedSessionID: parts[1], lastMirrored: null })
        await store.flush()
        onSelect(parts[1])
        return ctx.reply(`Выбрана сессия ${parts[1]}`)
      }
      if (parts[0] === 'perm') {
        const [sessionID, requestID, decision] =
          parts.length === 4 ? [parts[1], parts[2], parts[3]] : [selected(), parts[1], parts[2]]
        if (!sessionID || !requestID) return
        await client.replyPermission({ sessionID, requestID, reply: decision })
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {})
        return ctx.reply(`Решение по ${requestID}: ${decision}`)
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

export function createBot({ token, client, store, config, log = () => {}, mirror, pollMs = 3000 }) {
  const bot = new Bot(token)
  const handlers = createHandlers({
    client,
    store,
    config,
    log,
    files: telegramFiles(bot, token),
    onSelect: (id) => mirror?.watch?.(id),
  })
  const seen = new Set()
  let poller = null

  bot.on('message', (ctx) => handlers.onMessage(ctx))
  bot.on('callback_query', (ctx) => handlers.onCallback(ctx))

  async function pollPermissions() {
    const ownerID = config.ownerID
    if (!ownerID) return
    let pending
    try {
      pending = await client.pendingPermissions()
    } catch (error) {
      log(`permission poll failed: ${error.message}`)
      return
    }
    for (const request of pending ?? []) {
      if (seen.has(request.id)) continue
      seen.add(request.id)
      const text = [
        `Подтверждение: ${request.action}`,
        (request.resources ?? []).join('\n').slice(0, 600),
        request.message ?? '',
        `сессия: ${request.sessionID}`,
      ]
        .filter(Boolean)
        .join('\n')
      try {
        await bot.api.sendMessage(ownerID, text, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Разрешить', callback_data: `perm:${request.sessionID}:${request.id}:once` },
                { text: 'Всегда', callback_data: `perm:${request.sessionID}:${request.id}:always` },
                { text: 'Запретить', callback_data: `perm:${request.sessionID}:${request.id}:reject` },
              ],
            ],
          },
        })
      } catch (error) {
        log(`permission card failed: ${error.message}`)
      }
    }
  }

  async function start() {
    bot.start({ onStart: (info) => log(`bot @${info.username} started`) })
    poller = setInterval(() => pollPermissions().catch(() => {}), pollMs)
    poller.unref?.()
  }

  async function stop() {
    if (poller) clearInterval(poller)
    await bot.stop()
  }

  return { bot, handlers, start, stop, pollPermissions }
}

export { splitMessage }
