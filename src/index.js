import { createServer } from 'node:http'
import { createStore } from './state.js'
import { createClient } from './api.js'
import { createCompletionTracker } from './completions.js'
import { createCompletionDelivery } from './completion-delivery.js'
import { createBot } from './bot.js'
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
  completionCursors: {},
  completionInitialized: false,
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

const { bot, start, stop } = createBot({
  token: env.TELEGRAM_BOT_TOKEN,
  client,
  store,
  config,
  log,
  transcribe: transcriber ? (args) => transcriber.transcribe(args) : undefined,
})

const delivery = createCompletionDelivery({
  ownerID: config.ownerID,
  sendMessage: (ownerID, text) => bot.api.sendMessage(ownerID, text),
  log,
})
const completions = createCompletionTracker({ client, store, onComplete: delivery, log })

const health = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200).end('ok')
    return
  }
  res.writeHead(404).end()
}).listen(Number(env.PORT ?? 8080), () => log(`healthz on ${env.PORT ?? 8080}`))

startServices({
  startCompletions: () => completions.start(),
  startBot: () => startWithRetry(start, { log }),
  log,
})

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log(`${signal} received, shutting down`)
    completions.stop()
    health.close()
    stop().finally(() => process.exit(0))
  })
}
