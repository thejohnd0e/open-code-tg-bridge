import { createServer } from 'node:http'
import { createStore } from './state.js'
import { createClient } from './api.js'
import { createMirror } from './events.js'
import { createBot, splitMessage } from './bot.js'
import { startWithRetry } from './retry.js'

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

let send = async () => {}
const mirror = createMirror({
  client,
  store,
  log,
  onMessage: async (sessionID, text) => {
    for (const part of splitMessage(text)) await send(part)
  },
})

const { bot, start, stop } = createBot({ token: env.TELEGRAM_BOT_TOKEN, client, store, config, log, mirror })

send = async (text) => {
  if (!config.ownerID) return log('no OWNER_TELEGRAM_ID, drop mirrored message')
  await bot.api.sendMessage(config.ownerID, text)
}

const health = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200).end('ok')
    return
  }
  res.writeHead(404).end()
}).listen(Number(env.PORT ?? 8080), () => log(`healthz on ${env.PORT ?? 8080}`))

await startWithRetry(start, { log })
mirror.start().catch((error) => log(`mirror stopped: ${error.message}`))

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log(`${signal} received, shutting down`)
    mirror.stop()
    health.close()
    stop().finally(() => process.exit(0))
  })
}
