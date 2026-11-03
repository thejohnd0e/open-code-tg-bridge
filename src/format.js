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

export function formatSessionList(sessions, selectedID, limit = 10) {
  if (!sessions.length) return 'Сессий нет.'
  return sessions
    .slice(0, limit)
    .map((s, i) => {
      const mark = s.id === selectedID ? '→ ' : '   '
      const title = truncate(s.title || '(без названия)', 60)
      const dir = lastSegment(s.location?.directory)
      return `${mark}${i + 1}. ${title}${dir ? ` — ${dir}` : ''}`
    })
    .join('\n')
}

export function sessionChoiceRows(sessions, limit = 10) {
  return sessions.slice(0, limit).map((s, i) => [
    { text: `${i + 1}. ${truncate(s.title || '(без названия)', 40)}`, callback_data: `sel:${s.id}` },
  ])
}
