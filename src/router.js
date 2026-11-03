export const MAX_FILE_BYTES = 20 * 1024 * 1024

const COMMANDS = new Set(['start', 'sessions', 'status', 'new', 'help', 'model'])
const BUTTON_COMMANDS = new Map([
  ['sessions', 'sessions'],
  ['new', 'new'],
  ['model', 'model'],
  ['status', 'status'],
  ['help', 'help'],
])

export function isOwner(userID, ownerID) {
  if (ownerID === null || ownerID === undefined || ownerID === '') return false
  return Number(userID) === Number(ownerID)
}

export function parseCommand(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) {
    const buttonCommand = BUTTON_COMMANDS.get(trimmed.toLocaleLowerCase('ru-RU'))
    return buttonCommand ? { name: buttonCommand, args: '' } : null
  }
  const [raw, ...rest] = trimmed.split(/\s+/)
  const name = raw.slice(1).split('@')[0].toLowerCase()
  if (!COMMANDS.has(name)) return { name: 'unknown', args: rest.join(' ') }
  return { name, args: rest.join(' ') }
}

export function checkFileSize(size) {
  if (size > MAX_FILE_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(1)
    return {
      ok: false,
      reason: `Файл ${mb} МБ больше лимита Telegram в 20 МБ (после base64 он весит ещё на треть больше). Пришлите файл поменьше.`,
    }
  }
  return { ok: true }
}

