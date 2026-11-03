import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createTranscriber } from '../src/whisper.js'

async function withServer(handler, fn) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await fn(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('transcribe отправляет токен и файл, возвращает текст', async () => {
  let seen
  await withServer(
    async (req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      await new Promise((resolve) => req.on('end', resolve))
      seen = { url: req.url, token: req.headers['x-whisper-token'], type: req.headers['content-type'], body }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: ' привет мир ' }))
    },
    async (url) => {
      const transcriber = createTranscriber({ url, token: 'secret' })
      const text = await transcriber.transcribe({ dataBase64: Buffer.from('OggS').toString('base64'), mime: 'audio/ogg', name: 'voice.ogg' })
      assert.equal(seen.url, '/transcribe')
      assert.equal(seen.token, 'secret')
      assert.match(seen.type, /multipart\/form-data/)
      assert.match(seen.body, /name="file"/)
      assert.equal(text, 'привет мир')
    },
  )
})

test('ошибка сервиса превращается в исключение', async () => {
  await withServer(
    (req, res) => res.writeHead(503).end('down'),
    async (url) => {
      const transcriber = createTranscriber({ url, token: 'secret' })
      await assert.rejects(() => transcriber.transcribe({ dataBase64: 'AAA=', mime: 'audio/ogg' }), /whisper 503/)
    },
  )
})
