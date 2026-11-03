import { splitMessage } from './format.js'

export function formatCompletionMessage({ project, title, text }) {
  const location = [project, title].filter(Boolean).join(' · ')
  const header = ['✅ All done', location].filter(Boolean).join('\n')
  return text?.trim() ? `${header}\n\n${text}` : header
}

export function createCompletionDelivery({ ownerID, sendMessage, store, log = () => {} }) {
  let ephemeralState = {}
  const progressStore = store ?? {
    get: () => ephemeralState,
    set: (patch) => { ephemeralState = { ...ephemeralState, ...patch } },
    flush: async () => {},
  }
  return async (completion) => {
    if (!ownerID) {
      log('no OWNER_TELEGRAM_ID, drop completion notification')
      return
    }
    const parts = splitMessage(formatCompletionMessage(completion))
    const saved = progressStore.get().completionDeliveryParts?.[completion.sessionID]
    const startAt = saved && saved.completionID === completion.completionID ? (saved.nextPart ?? 0) : 0
    for (let index = startAt; index < parts.length; index += 1) {
      await sendMessage(ownerID, parts[index])
      const completionDeliveryParts = { ...(progressStore.get().completionDeliveryParts ?? {}) }
      completionDeliveryParts[completion.sessionID] = { completionID: completion.completionID, nextPart: index + 1 }
      progressStore.set({ completionDeliveryParts })
      await progressStore.flush()
    }
    log(`completion delivered ${completion.sessionID} ${completion.completionID} ${completion.text.length} chars`)
  }
}
