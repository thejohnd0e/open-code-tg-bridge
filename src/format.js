const MAX_MESSAGE = 4096

function truncate(text, limit) {
  if (text.length <= limit) return text
  const cut = [...text].slice(0, limit - 1).join('')
  return `${cut}…`
}

export function splitMessage(text, limit = MAX_MESSAGE) {
  if (text.length <= limit) return [text]
  const parts = []
  let rest = text
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit)
    if (cut <= 0) cut = rest.lastIndexOf('\n', limit)
    if (cut <= 0) cut = rest.lastIndexOf(' ', limit)
    if (cut <= 0) cut = limit
    // never cut a surrogate pair in half
    const code = rest.charCodeAt(cut - 1)
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1
    if (cut <= 0) cut = 1
    parts.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest.length) parts.push(rest)
  return parts
}

function lastSegment(directory) {
  if (!directory) return ''
  const segments = directory.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? ''
}

function clampPage(page, pageCount) {
  return Math.min(pageCount, Math.max(1, Number.isInteger(page) ? page : 1))
}

export function formatSessionList(sessions, selectedID, limit = 10, page = 1) {
  if (!sessions.length) return 'No sessions found.'
  const pageCount = Math.max(1, Math.ceil(sessions.length / limit))
  const currentPage = clampPage(page, pageCount)
  const start = (currentPage - 1) * limit
  return sessions
    .slice(start, start + limit)
    .map((s, index) => {
      const i = start + index
      const mark = s.id === selectedID ? '→ ' : '   '
      const title = truncate(s.title || '(untitled)', 60)
      const dir = lastSegment(s.location?.directory)
      return `${mark}${i + 1}. ${title}${dir ? ` — ${dir}` : ''}`
    })
    .join('\n')
    .replace(/^/, `Sessions — Page ${currentPage} of ${pageCount}\n`)
}

export function sessionChoiceRows(sessions, limit = 10, page = 1) {
  const pageCount = Math.max(1, Math.ceil(sessions.length / limit))
  const currentPage = clampPage(page, pageCount)
  const start = (currentPage - 1) * limit
  return sessions.slice(start, start + limit).map((session, index) => [
    { text: `${start + index + 1}. ${truncate(session.title || '(untitled)', 40)}`, callback_data: `sel:${session.id}` },
  ])
}

export function sessionNavigationRows(sessions, page, limit = 10) {
  const pageCount = Math.max(1, Math.ceil(sessions.length / limit))
  const currentPage = clampPage(page, pageCount)
  const buttons = []
  if (currentPage > 1) buttons.push({ text: '‹ Previous', callback_data: `sp:${currentPage - 1}` })
  if (currentPage < pageCount) buttons.push({ text: 'Next ›', callback_data: `sp:${currentPage + 1}` })
  return buttons.length ? [buttons] : []
}

export function sessionTitle(now, timeZone = 'Europe/Moscow') {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now)
  return `Telegram ${formatted.replace(',', '')}`
}

export function recentModels(sessions, limit = 8) {
  const seen = new Set()
  const out = []
  for (const session of sessions) {
    const model = session?.model
    if (!model?.id || !model?.providerID) continue
    const key = `${model.providerID}/${model.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ providerID: model.providerID, id: model.id })
    if (out.length >= limit) break
  }
  return out
}

export function modelRows(models, current) {
  return models.map((model, index) => {
    const isCurrent = model.providerID === current?.providerID && model.id === current?.id
    return [{ text: `${isCurrent ? '✓ ' : ''}${model.providerID}/${model.id}`, callback_data: `mdl:${index}` }]
  })
}

export function permissionCardText(request, session) {
  const where = session
      ? `${truncate(session.title || '(untitled)', 60)} · ${lastSegment(session.location?.directory)}`
    : request.sessionID
  return [
    `Approval required: ${request.action}`,
    (request.resources ?? []).join('\n').slice(0, 600),
    request.message,
    `Session: ${where}`,
  ]
    .filter(Boolean)
    .join('\n')
}
