# OpenCode Telegram Bridge

[![CI](https://github.com/thejohnd0e/open-code-tg-bridge/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/thejohnd0e/open-code-tg-bridge/actions/workflows/ci.yml)

A private Telegram client for an OpenCode server. The authorized owner can select
sessions across projects, send text and attachments, receive completion summaries,
and respond to permission requests. Voice transcription is optional and uses a
separate service.

## Requirements

- Node.js 22 or later
- An OpenCode server API URL and password
- A Telegram bot token and the owner's Telegram user ID

## Setup and run

```bash
npm install
npm test
```

For local runtime use, provide `TELEGRAM_BOT_TOKEN`, `OPENCODE_URL`,
`OPENCODE_TOKEN`, and `OWNER_TELEGRAM_ID`, then run:

```bash
npm start
```

Optional settings: `STATE_FILE` (defaults to `./state.json`), `PORT` (defaults to
`8080`), `LIGHT_DIR`, `LIGHT_MODEL`, `WHISPER_URL`, and `WHISPER_TOKEN`. The
container sets `STATE_FILE=/data/state.json` and persists `/data` in the
`tg-state` Docker volume. Do not commit secrets; deployment instructions are in
[`docs/deploy.md`](docs/deploy.md).

## Build and test

There is no separate build or lint script. The production image is built with
`docker compose build`. Run all tests with `npm test`, or one test file with
`node --test test/<name>.test.js`.

## Documentation

- [Architecture](docs/architecture.md)
- [Deployment](docs/deploy.md)
- [Operations](docs/operations.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Voice service](docs/voice-service.md)
- [OpenCode API notes](docs/api-notes.md)
