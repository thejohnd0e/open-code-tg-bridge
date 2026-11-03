import { createServer } from 'node:http'
import { createStore } from './state.js'
import { createClient } from './api.js'
import { createMirror } from './events.js'
import { createBot, splitMessage } from './bot.js'
import { startWithRetry } from './retry.js'
import { startServices } from './services.js'
import { createTranscriber } from './whisper.js'

const env = process.env
const log = (...args) => console.log(new Date().toISOString(), ...args)

for (const key of ['TELEGRAM_BOT_TOKEN', 'OPENCODE_URL', 'OPENCODE_TOKEN']) {
  if (!env[key]) {
    log(`missing env ${key}`)
    process.exit(1)
  }
}

const store = createStore(env.STATE_FILE ?? './state.json', {
  ownerID: null,
  selectedSessionID: null,
  updateID: 0,
  lastMirrored: null,
})

const config = {
  ownerID: env.OWNER_TELEGRAM_ID ? Number(env.OWNER_TELEGRAM_ID) : null,
  lightDir: env.LIGHT_DIR ?? 'C:/Example/Project',
  lightModel: env.LIGHT_MODEL ?? 'opencode-go/gpt-6-luna',
}

const client = createClient({ url: env.OPENCODE_URL, password: env.OPENCODE_TOKEN })

const transcriber = env.WHISPER_URL
  ? createTranscriber({ url: env.WHISPER_URL, token: env.WHISPER_TOKEN ?? '' })
  : null
if (!transcriber) log('WHISPER_URL is empty: voice messages will be refused')

let send = async () => {}
const mirror = createMirror({
  client,
  store,
  log,
  onMessage: async (sessionID, text) => {
    for (const part of splitMessage(text)) await send(part)
  },
})

const { bot, start, stop } = createBot({
  token: env.TELEGRAM_BOT_TOKEN,
  client,
  store,
  config,
  log,
  mirror,
  transcribe: transcriber ? (args) => transcriber.transcribe(args) : undefined,
})

send = async (text) => {
  if (!config.ownerID) return log('no OWNER_TELEGRAM_ID, drop mirrored message')
  try {
    await bot.api.sendMessage(config.ownerID, text)
  } catch (error) {
    log(`telegram send failed: ${error.message}`)
    throw error
  }
}

const health = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200).end('ok')
    return
  }
  res.writeHead(404).end()
}).listen(Number(env.PORT ?? 8080), () => log(`healthz on ${env.PORT ?? 8080}`))

startServices({
  startMirror: () => mirror.start(),
  startBot: () => startWithRetry(start, { log }),
  log,
})

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log(`${signal} received, shutting down`)
    mirror.stop()
    health.close()
    stop().finally(() => process.exit(0))
  })
}
