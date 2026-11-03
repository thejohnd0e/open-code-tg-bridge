const DEFAULT_TIMEOUT = 30_000

function toAttachment({ name, mime, dataBase64 }) {
  return {
    uri: `data:${mime};base64,${dataBase64}`,
    source: { type: 'inline' },
    ...(name ? { name } : {}),
  }
}

export function createClient({ url, password, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT }) {
  const base = url.replace(/\/+$/, '')
  const auth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`

  async function call(method, path, body) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        authorization: auth,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 401) throw new Error('авторизация OpenCode не прошла (401): проверьте OPENCODE_TOKEN')
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`OpenCode ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`)
    }
    if (res.status === 204) return null
    const payload = await res.json()
    return payload?.data ?? payload
  }

  return {
    listSessions: ({ limit = 20 } = {}) => call('GET', `/api/session?limit=${limit}`),

    createSession: ({ directory, title, model }) =>
      call('POST', '/api/session', {
        title,
        model,
        location: { directory },
      }),

    prompt: ({ sessionID, text, files = [], delivery }) =>
      call('POST', `/api/session/${sessionID}/prompt`, {
        text,
        ...(files.length ? { files: files.map(toAttachment) } : {}),
        ...(delivery ? { delivery } : {}),
      }),

    messages: (sessionID, { limit = 50 } = {}) =>
      call('GET', `/api/session/${sessionID}/message?limit=${limit}`),

    pendingPermissions: () => call('GET', '/api/permission/request'),

    switchModel: ({ sessionID, model }) => call('POST', `/api/session/${sessionID}/model`, { model }),

    activeSessions: async () => {
      const map = await call('GET', '/api/session/active')
      return Object.keys(map ?? {})
    },

    sessionPermissions: (sessionID) => call('GET', `/api/session/${sessionID}/permission`),

    replyPermission: ({ sessionID, requestID, decision }) =>
      call('POST', `/api/session/${sessionID}/permission/${requestID}/reply`, { decision }),

    async eventStream({ signal, onEvent }) {
      const res = await fetchImpl(`${base}/api/event`, {
        headers: { authorization: auth, accept: 'text/event-stream' },
        signal,
      })
      if (res.status === 401) throw new Error('авторизация OpenCode не прошла (401): проверьте OPENCODE_TOKEN')
      if (!res.ok) throw new Error(`OpenCode GET /api/event → ${res.status}`)
      const decoder = new TextDecoder()
      let buffer = ''
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true })
        let index
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          const data = block
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('\n')
          if (!data) continue
          try {
            onEvent(JSON.parse(data))
          } catch {
            // ignore malformed event, keep the stream alive
          }
        }
      }
    },
  }
}
