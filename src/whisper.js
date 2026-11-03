export function createTranscriber({ url, token, fetchImpl = fetch, timeoutMs = 180_000 }) {
  const base = url.replace(/\/+$/, '')
  return {
    async transcribe({ dataBase64, mime, name = 'voice.ogg' }) {
      const form = new FormData()
      form.append('file', new Blob([Buffer.from(dataBase64, 'base64')], { type: mime }), name)
      const res = await fetchImpl(`${base}/transcribe`, {
        method: 'POST',
        headers: { 'x-whisper-token': token },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 401) throw new Error('whisper 401: неверный токен распознавания')
      if (!res.ok) throw new Error(`whisper ${res.status}`)
      const payload = await res.json()
      return (payload?.text ?? '').trim()
    },
  }
}
