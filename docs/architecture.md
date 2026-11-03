# Architecture

```
 phone ──Telegram Bot API──┐
                          │  long polling
                 ┌────────▼─────────┐
                 │ tg-bridge        │  container on Linux host (192.0.2.12)
                 │ Node 22 + grammY │
                 └───┬─────────┬────┘
     HTTP Basic      │         │  multipart + x-whisper-token
┌────────────────────▼──┐   ┌──▼─────────────────────┐
│ OpenCode API          │   │ Whisper (faster-whisper)│
│ 192.0.2.221:28894   │   │ 192.0.2.221:28895     │
│ → Windows 127.0.0.1   │   │ → Windows 127.0.0.1     │
└───────────────────────┘   └─────────────────────────┘
```

Both ports are published from the Windows server through `netsh portproxy`; the
firewall allows connections only from `192.0.2.12`.

The `192.0.2.0/24` addresses shown here are reserved documentation examples, not
deployment addresses.

## Why this design

- **Sessions live on the Windows server.** It is always on and is also accessed
  over RDP. The bot is another client of the same API as the TUI, so it sees all
  projects.
- **The bot runs on the Linux host, not Windows.** Docker, logs, and
  automatic restarts. The tradeoff is that the API must be exposed on the LAN,
  protected by an IP filter and password.
- **`portproxy` instead of moving the server onto the LAN.** OpenCode continues
  listening on loopback, so TUI and RDP keep working as before; only the forwarded
  port is exposed. A reverse SSH tunnel was considered and rejected because it
  would add a process to supervise after reboots.
- **Whisper runs on Windows.** The Linux host also runs network services, while
  the Windows host provides GPU acceleration for transcription.

## Repository components

| File | Responsibility |
|---|---|
| `src/index.js` | Reads environment variables, wires dependencies, starts healthz |
| `src/services.js` | Starts the completion tracker and bot independently |
| `src/api.js` | OpenCode HTTP client: Basic auth, endpoints, SSE parsing |
| `src/completions.js` | Tracks successful completions across sessions and recovers missed ones |
| `src/completion-delivery.js` | Formats completion notifications and splits long messages |
| `src/permissions.js` | Polls active sessions for permission requests and builds cards |
| `src/bot.js` | grammY commands, attachments, voice, and buttons |
| `src/router.js` | Owner checks, command parsing, and file-size limits |
| `src/format.js` | Splits long messages; formats lists and cards |
| `src/state.js` | On-disk state with atomic writes |
| `src/whisper.js` | Client for the transcription service |
| `src/retry.js` | Restarts the bot if Telegram is unavailable |

## Data flows

**Telegram message.** `message` → owner filter → `/sessions|/status|/new|/help`
or `POST /api/session/{id}/prompt` with text and files (files are sent as
`data:<mime>;base64,…`, `source: inline`). The API responds immediately with the
queued inbox item; the bot does not wait for the turn to finish.

The filter checks both the Telegram user ID and that the chat is private with the
same chat ID. Matching user ID alone is not enough: owner messages in groups are
ignored too. `/sessions` loads sessions through API cursors and shows 10 per page;
inline buttons `‹ Previous` / `Next ›` provide access to every project.

**Agent completion.** The bot maintains a global SSE subscription to
`GET /api/event` and listens for `session.execution.succeeded` from every session.
Intermediate `session.text.*`, reasoning, and tool output are not forwarded. From
session history, it selects the last assistant message before
`idle/outcome=succeeded` and sends one final notification to Telegram.

On first startup, OpenCode session metadata establishes a baseline for each
session: old completions are not sent and histories are not bulk-loaded. Separate
`time.updated` and completion IDs are stored per session. After a disconnect,
history is read only for changed sessions; new `idle/succeeded` completions are
delivered once and in order. Sessions and histories are read using API cursors.

**Approvals.** Every 3 seconds, the bot requests `GET /api/session/active`, then
`GET /api/session/{id}/permission` for each active session. Each new request
becomes a card containing the action, resources, project, and session, with three
buttons. A button carries a short numeric key mapped in memory; the decision is
sent to `POST /api/session/{id}/permission/{requestID}/reply` with `{decision}`.

**Voice.** `voice|audio` → download through the Bot API (≤ 20 MB) →
`POST /transcribe` → send the transcribed text to the session.

## State

`/data/state.json` on the `tg-state` volume:

```json
{
  "ownerID": null,
  "selectedSessionID": "ses_…",
    "updateID": 1,
  "completionInitialized": true,
  "completionCursors": {
      "ses_example": { "completionID": "msg_idle_example", "eventID": "evt_example", "updatedAt": 0 }
  },
  "completionDeliveryParts": {
      "ses_example": { "completionID": "msg_idle_example", "nextPart": 1 }
  }
}
```

- `updateID` prevents processing the same update twice after a restart.
- `completionInitialized` distinguishes the initial baseline (do not send old
  history) from later reconnects (deliver missed completions).
- `completionCursors` stores the last delivered successful turn for each session.
- `completionDeliveryParts` stores progress through long multi-part messages; a
  retry resumes at the next unconfirmed part. The Bot API has no idempotency key,
  so a timeout after Telegram accepts a message can cause one part to be repeated.
- `ownerID` in this file is unused; the owner comes from `OWNER_TELEGRAM_ID`.
