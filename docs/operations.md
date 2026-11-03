# Operations

## Health

```bash
docker ps --filter name=tg-bridge            # Up (healthy)
docker exec tg-bridge node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>r.text()).then(console.log)"
```

`healthz` returns `ok` even if Telegram or OpenCode is unavailable: it reports
that the container is alive, while errors appear in the logs. This is intentional;
otherwise, an invalid token could cause a restart loop.

## Logs

```bash
docker logs --since 30m tg-bridge 2>&1 | tail -50
docker logs -f tg-bridge
```

| Log line | Meaning |
|---|---|
| `bot started` | The bot started |
| `unauthorized user_id=N` | An unknown account sent a message, or the owner has not been configured |
| `completion delivered …` | A completed-session summary was sent to Telegram |
| `completion send failed for ses_…` | Telegram rejected a summary; its cursor was not advanced, so periodic sync or reconnect will retry |
| `completion history failed for ses_…` | Could not read this session's history for recovery |
| `completion event failed for ses_…` | Failed to process a completion event |
| `completion tracker stopped: …` | The tracker stopped unexpectedly; the container remains alive, so check the adjacent error |
| `completion event stream error: …` | The event stream disconnected and will reconnect |
| `handler failed: …` | A handler failed |
| `transcribe failed: …` | Transcription failed |

Intermediate messages are not forwarded. Each completion is recorded with one
`completion delivered` line. History is reconciled every 30 seconds; if Telegram
fails, delivery is retried without waiting for an SSE disconnect.

## Upgrade

```bash
# Run tests locally
cd telegram-bridge && npm test

# Package and build on the server
tar -czf tgbridge.tgz package.json package-lock.json src Dockerfile compose.yaml .env.example
scp tgbridge.tgz root@192.0.2.1:/root/
ssh root@192.0.2.1 'tar -xzf /root/tgbridge.tgz -C /root/TgBridge && cd /root/TgBridge && docker compose build && docker compose up -d --no-build'
```

Use `--force-recreate` if `.env` changed; environment variables are read only
when the container is created.

## Keyboard and session list

The persistent keyboard appears after `/start` or `/help`. `/sessions` shows 10
sessions per page: use `‹ Previous` / `Next ›` to navigate, or `/sessions N` to
open page N directly. The bot only handles the owner's private chat; owner
commands in groups are ignored too. All bot-authored interface text is English;
OpenCode-authored response content is passed through unchanged.

## Restart

```bash
docker restart tg-bridge         # State and selected session are preserved
```

After startup, the bot reconciles session history and sends only missed
completions. A response that finishes during a restart is delivered once after
the bot returns.

## Back up state

```bash
docker exec tg-bridge cat /data/state.json > state-backup.json
```

To restore, put the file back in the volume and restart the container. It contains
no secrets, only session IDs and cursors.

## Secrets

| Secret | Location |
|---|---|
| Bot token | `/root/TgBridge/.env` (permissions `600`) on Linux host |
| OpenCode API password | Same file and `~/.config/opencode/service.json` on Windows |
| Transcription token | Same file and `C:/Example/Project` |

`.env` is excluded from Git by `.gitignore`.
