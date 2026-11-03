import { splitMessage } from './format.js'

export function formatCompletionMessage({ project, title, text }) {
  const location = [project, title].filter(Boolean).join(' · ')
  const header = ['✅ Всё сделано, готово', location].filter(Boolean).join('\n')
  return text?.trim() ? `${header}\n\n${text}` : header
}

export function createCompletionDelivery({ ownerID, sendMessage, log = () => {} }) {
  return async (completion) => {
    if (!ownerID) {
      log('no OWNER_TELEGRAM_ID, drop completion notification')
      return
    }
    const parts = splitMessage(formatCompletionMessage(completion))
    for (const part of parts) await sendMessage(ownerID, part)
    log(`completion delivered ${completion.sessionID} ${completion.completionID} ${completion.text.length} chars`)
  }
}
