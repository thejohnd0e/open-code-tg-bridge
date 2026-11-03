# OpenCode Telegram Bridge

A Telegram client for OpenCode. It lets an authorized owner select sessions from
any project, send text and attachments, receive completion summaries, and respond
to permission requests.

## Requirements

- Node.js 22 or later
- Access to an OpenCode server API
- A Telegram bot token and the owner's Telegram user ID

## Install and test

```bash
npm install
npm test
```

## Documentation

- [Architecture](docs/architecture.md)
- [Deployment](docs/deploy.md)
- [Operations](docs/operations.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Voice service](docs/voice-service.md)
- [OpenCode API notes](docs/api-notes.md)

The voice recognition service is in [`voice-service/`](voice-service/) and runs
separately from the Telegram bridge container.
