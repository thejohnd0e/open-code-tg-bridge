import { Bot } from 'grammy'
import { isOwner, parseCommand, checkFileSize } from './router.js'
import { formatSessionList, sessionChoiceRows, sessionNavigationRows, splitMessage, sessionTitle, recentModels, modelRows } from './format.js'
import { pollPermissionCards } from './permissions.js'

const NO_SESSION = 'Please select a session first: /sessions'
const SERVER_DOWN = 'OpenCode server is unavailable. Please try again later.'
const SESSION_PAGE_SIZE = 10
const REPLY_KEYBOARD = {
  keyboard: [
    [{ text: 'Sessions' }, { text: 'New' }],
    [{ text: 'Model' }, { text: 'Status' }, { text: 'Help' }],
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
      id ? `Ready. Current session: ${id}` : 'Ready. No session selected yet: /sessions',
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
    if (!id) return ctx.reply('No session selected. /sessions')
    const sessions = await client.listSessions({ limit: 20 })
    const session = (sessions ?? []).find((s) => s.id === id)
    if (!session) return ctx.reply(`Selected session ${id} (not found among the latest 20)`)
    await ctx.reply(`Current session:\n${session.title || '(untitled)'}\n${session.location?.directory ?? ''}\nID: ${session.id}`)
  }

  async function onNew(ctx) {
    const session = await client.createSession({
      directory: config.lightDir,
      title: sessionTitle(now(), config.timeZone),
      model: parseModel(config.lightModel),
    })
    store.set({ selectedSessionID: session.id })
    await store.flush()
    await ctx.reply(`Created lightweight session “${session.title ?? session.id}” in ${config.lightDir}`)
  }

  async function onHelp(ctx) {
    await ctx.reply(
      [
        '/sessions — choose a session from any project',
        '/status — show the current session',
        '/new — create a lightweight session for quick questions',
        '/model — change the selected session’s model',
        '/help — show this help',
        '',
        'Text, photos, documents, and voice messages are sent to the selected session.',
        'Replies appear here; long messages are split into parts.',
        'Approval requests appear as cards with “Allow once / Always allow / Deny” buttons.',
        '',
        'Telegram does not provide files larger than 20 MB to bots.',
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
          return ctx.reply('Unknown command. /help')
      }
    }
    const id = selected()
    if (!id) return ctx.reply(NO_SESSION)
    await client.prompt({ sessionID: id, text: ctx.message.text })
    await ctx.reply('↗ Sent')
  }

  async function onFile(ctx) {
    const id = selected()
    const ref = pickFile(ctx.message)
    if (!id) return ctx.reply(NO_SESSION)
    const limit = checkFileSize(ref.size)
    if (!limit.ok) return ctx.reply(limit.reason)
    const file = await files.download(ref)
    await client.prompt({ sessionID: id, text: ctx.message.caption ?? '', files: [file] })
    await ctx.reply(`↗ ${file.name} (${Math.round(file.size / 1024)} KB) sent`)
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
      return ctx.reply('Could not transcribe the voice message: speech recognition is unavailable. Type your message or try again later.')
    }
    if (!text) return ctx.reply('No speech was detected. Try again or type your message.')
    await client.prompt({ sessionID: id, text: `Voice message: ${text}` })
    await ctx.reply(`↗ «${text.slice(0, 300)}»`)
  }

  async function onModel(ctx) {
    const id = selected()
    if (!id) return ctx.reply(NO_SESSION)
    const sessions = await client.listSessions({ limit: 30 })
    const models = recentModels(sessions)
    if (!models.length) return ctx.reply('No models found in recent sessions.')
    modelChoices = models
    const current = (sessions ?? []).find((s) => s.id === id)?.model
    const label = current ? `${current.providerID}/${current.id}` : 'unknown'
    await ctx.reply(`Current session model: ${label}\nChoose a model:`, {
      reply_markup: { inline_keyboard: modelRows(models, current) },
    })
  }

  async function onMessage(ctx) {
    await guarded(ctx, async () => {
      const message = ctx.message ?? {}
      if (message.voice || message.audio) return onVoice(ctx)
      if (message.photo || message.document) return onFile(ctx)
      if (typeof message.text === 'string') return onText(ctx)
      return ctx.reply('Videos and stickers are not supported yet. Send text, a file, or a voice message instead.')
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
        return ctx.reply(`Selected session ${parts[1]}`)
      }
      if (parts[0] === 'mdl') {
        const model = modelChoices[Number(parts[1])]
        if (!model) return ctx.reply('This selection has expired. Open /model again.')
        const sessionID = selected()
        if (!sessionID) return ctx.reply(NO_SESSION)
        await client.switchModel({ sessionID, model })
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {})
        return ctx.reply(`Session model changed to ${model.providerID}/${model.id}`)
      }
      if (parts[0] === 'perm') {
        const card = permissionCards.get(parts[1])
        if (!card) {
          await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {})
          return ctx.reply('This approval request is stale; it is no longer active.')
        }
        const decision = parts[2]
        await client.replyPermission({ sessionID: card.sessionID, requestID: card.requestID, decision })
        permissionCards.delete(parts[1])
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {})
        return ctx.reply(`Decision for ${card.requestID}: ${decision}`)
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
        { command: 'sessions', description: 'Choose a session from any project' },
        { command: 'status', description: 'Show the current session' },
        { command: 'new', description: 'Create a lightweight session' },
        { command: 'model', description: 'Change the session model' },
        { command: 'help', description: 'Show help' },
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




