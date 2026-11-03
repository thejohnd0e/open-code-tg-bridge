# OpenCode Telegram Bridge documentation

The Telegram bot is a second interface to OpenCode. From a phone, the owner can
select a session in any project, send text, photos, documents, or voice messages,
receive a completion notification for any session, and approve tool requests.

## Start here

| Document | Covers |
|---|---|
| [architecture.md](architecture.md) | Components, data flows, ports, and access control |
| [deploy.md](deploy.md) | Initial setup, `.env`, port forwarding, and container build |
| [operations.md](operations.md) | Health, logs, upgrades, and backups |
| [troubleshooting.md](troubleshooting.md) | Known failure modes and how to investigate them |
| [voice-service.md](voice-service.md) | Local GPU speech recognition with Whisper |
| [api-notes.md](api-notes.md) | OpenCode API behavior verified in practice |
| [2026-11-03-telegram-bridge-design.md](2026-11-03-telegram-bridge-design.md) | Original goals, constraints, and design |
| [2026-11-03-voice-design.md](2026-11-03-voice-design.md) | Voice transcription design |
| [plans/2026-11-03-telegram-bridge.md](plans/2026-11-03-telegram-bridge.md) | Historical implementation plan |

## At a glance

- **Bot:** `tg-bridge` container on a Linux host (`192.0.2.12`), Node 22 + grammY,
  long polling.
- **OpenCode API:** Windows server on `127.0.0.1:28894`, exposed to the LAN via
  `netsh portproxy` at `192.0.2.221:28894`; the firewall allows only
  `192.0.2.12`.
- **Voice:** `faster-whisper` `large-v3-turbo` with GPU acceleration, listening on
  `127.0.0.1:28895` and exposed at `192.0.2.221:28895` in the same way.
- **Access:** Only `OWNER_TELEGRAM_ID`; others receive no response and are logged.
- **State:** JSON on the `tg-state` Docker volume (selected session, `update_id`,
  and per-session completion cursors).
- **Tests:** `npm test` (`node --test`); 93 tests.

Addresses in the `192.0.2.0/24` range above are reserved documentation examples;
replace them with values from your own environment.

## Bot commands

```
/sessions — choose a session from any project (10 per page)
/status   — show the current session
/new      — create a lightweight session in the configured directory
/model    — change the selected session's model
/help     — show help
```

After `/start` or `/help`, Telegram shows a persistent keyboard with **Sessions**,
**New**, **Model**, **Status**, and **Help**. Slash command names are unchanged.

Other text, photos, documents, and voice messages are sent to the selected
session. OpenCode-authored replies, project names, and session titles pass through
unchanged. After a successful run, the bot sends one final notification with the
project and session names; progress messages are not forwarded. Long replies are
split into parts of up to 4,096 characters.
