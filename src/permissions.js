import { permissionCardText } from './format.js'

export async function pollPermissionCards({
  client,
  ownerID,
  sendMessage,
  cards,
  seen,
  log = () => {},
  keySeq = { value: 0 },
}) {
  if (!ownerID) return 0
  let active = []
  try {
    active = await client.activeSessions()
  } catch (error) {
    log(`active sessions failed: ${error.message}`)
    return 0
  }
  if (!active.length) return 0
  let byId = new Map()
  try {
    const sessions = await client.listSessions({ limit: 50 })
    byId = new Map((sessions ?? []).map((session) => [session.id, session]))
  } catch (error) {
    log(`permission session lookup failed: ${error.message}`)
  }
  let sent = 0
  for (const sessionID of active) {
    let requests = []
    try {
      requests = await client.sessionPermissions(sessionID)
    } catch (error) {
      log(`session permissions failed for ${sessionID}: ${error.message}`)
      continue
    }
    for (const request of requests ?? []) {
      if (seen.has(request.id)) continue
      const key = String(++keySeq.value)
      cards.set(key, { sessionID, requestID: request.id })
      try {
        await sendMessage(ownerID, permissionCardText(request, byId.get(sessionID)), {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Разрешить', callback_data: `perm:${key}:once` },
                { text: 'Всегда', callback_data: `perm:${key}:always` },
                { text: 'Запретить', callback_data: `perm:${key}:reject` },
              ],
            ],
          },
        })
        seen.add(request.id)
        sent += 1
      } catch (error) {
        cards.delete(key)
        log(`permission card failed: ${error.message}`)
      }
    }
  }
  return sent
}
