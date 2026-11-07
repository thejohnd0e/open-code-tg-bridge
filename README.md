# OpenCode Telegram Bridge

[![CI](https://github.com/thejohnd0e/open-code-tg-bridge/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/thejohnd0e/open-code-tg-bridge/actions/workflows/ci.yml)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-supported-2496ED?logo=docker&logoColor=white)](docs/deploy.md)
[![grammY](https://img.shields.io/badge/grammY-bot_framework-009DFF?logo=telegram&logoColor=white)](https://grammy.dev/)

Control and monitor your [OpenCode](https://opencode.ai) sessions from Telegram.
OpenCode Telegram Bridge connects your phone to a running OpenCode server so you
can switch between projects, send prompts or screenshots, approve tool permissions,
and get notified as soon as an agent finishes its work.

## Key Features

- **Work across all projects and sessions** — browse every session on your OpenCode
  server (paginated, 10 per page) and switch the active session at any time.
- **Send text, photos, and documents** — type prompts or attach screenshots and
  files (up to Telegram's 20 MB bot limit) directly into the selected session.
- **Completion notifications for every session** — receive a single `✅ All done`
  summary with the project name, session title, and final assistant reply whenever
  any session completes a turn, including turns started from the desktop TUI.
- **Interactive tool approvals** — when an agent needs permission to run a command
  or edit a protected resource, an approval card arrives in Telegram with
  **Allow once**, **Always allow**, and **Deny** buttons.
- **Voice prompts (optional)** — send voice or audio messages and have them
  transcribed automatically via an optional Whisper HTTP service before being sent
  to the session.
- **Quick sessions and model switching** — create a new lightweight session for
  quick questions (`/new`) or switch the current session's LLM (`/model`) from
  recent models.
- **Persistent one-tap keyboard** — access **Sessions**, **New**, **Model**,
  **Status**, and **Help** from a persistent Telegram reply keyboard without typing
  slash commands.
- **Single-owner privacy** — strictly locked to `OWNER_TELEGRAM_ID` in a private
  1-on-1 chat. Messages from other users or group chats are ignored.

## Commands & Usage

| Command / Button | Action |
|---|---|
| `/sessions` (**Sessions**) | List sessions across all projects (10 per page) and select one |
| `/new` (**New**) | Create and select a new lightweight session |
| `/model` (**Model**) | Switch the selected session's model from recently used models |
| `/status` (**Status**) | Show the currently selected session, project directory, and ID |
| `/help` (**Help**) | Show usage instructions and display the persistent reply keyboard |

Once a session is selected:
- **Any text message** is sent to the session as a prompt.
- **Photos and documents** are attached inline (`base64`) along with their caption.
- **Voice and audio messages** are transcribed (when `WHISPER_URL` is configured)
  and sent as `Voice message: <transcript>`.
- **Long responses** are automatically split into parts of up to 4,096 characters
  without breaking Unicode characters or lines.

---

## Technical Details

### Requirements

- **Node.js 22+** (or Docker with Docker Compose)
- A running **OpenCode server** reachable over HTTP (`OPENCODE_URL` and
  `OPENCODE_TOKEN` from `~/.config/opencode/service.json`)
- A **Telegram bot token** (from `@BotFather`) and your numeric Telegram user ID

### Quick Start

#### Run from npm

Create a `.env` file in your working directory with the variables listed below.
Keep it private and do not commit it; it contains credentials. Existing
environment variables take precedence over values in `.env`.

```bash
npx open-code-tg-bridge
```

Alternatively, install globally with `npm install -g open-code-tg-bridge` and
run `open-code-tg-bridge` from the directory containing your `.env` file.
The optional Whisper service is deployed separately; see the voice guide below.

#### Run from a source checkout

```bash
npm install
cp .env.example .env
# Fill in TELEGRAM_BOT_TOKEN, OPENCODE_URL, OPENCODE_TOKEN, and OWNER_TELEGRAM_ID
npm start
```

#### Run with Docker Compose

```bash
cp .env.example .env
# Edit .env with your local values
docker compose up -d --build
```

The container runs as the non-root `node` user, exposes `GET /healthz` on port
`8080`, and stores persistent state in `/data/state.json` on the `tg-state` Docker
volume so the selected session and notification cursors survive restarts.

### Configuration Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Telegram bot token from `@BotFather` |
| `OPENCODE_URL` | Yes | — | Base URL of the OpenCode HTTP API |
| `OPENCODE_TOKEN` | Yes | — | OpenCode Basic auth password (`opencode:<password>`) |
| `OWNER_TELEGRAM_ID` | Yes* | `null` | Numeric Telegram user ID of the authorized owner |
| `STATE_FILE` | No | `./state.json` | Path for atomic JSON state persistence (`/data/state.json` in Docker) |
| `PORT` | No | `8080` | Port for the HTTP `/healthz` endpoint |
| `LIGHT_DIR` | No | `process.cwd()` | Working directory on the OpenCode host for `/new` sessions |
| `LIGHT_MODEL` | No | `opencode-go/gpt-6-luna` | Model (`provider/id`) used when creating `/new` sessions |
| `WHISPER_URL` | No | — | Optional Whisper service URL (`POST /transcribe`) |
| `WHISPER_TOKEN` | No | `""` | Shared secret sent in the `x-whisper-token` header |

*\*If `OWNER_TELEGRAM_ID` is left empty on first run, the bot refuses all messages
and logs `unauthorized user_id=<id>` so you can find your ID and set it.*

### Development & Testing

```bash
# Run the full test suite
npm test

# Run a single test file
node --test test/bot.test.js
```

### Documentation

- [Overview & command summary](docs/README.md)
- [Architecture & data flows](docs/architecture.md)
- [Deployment guide](docs/deploy.md)
- [Operations & backups](docs/operations.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Optional Whisper voice service](docs/voice-service.md)
- [OpenCode API notes](docs/api-notes.md)
