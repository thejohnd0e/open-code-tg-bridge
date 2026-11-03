# Troubleshooting

All cases below were observed during the initial acceptance test on 2026-11-03.

## No completion notification arrives in Telegram

**Symptom:** An OpenCode turn finished, but no completion message was received.

**Cause:** Before the fix, `index.js` waited for Telegram long polling to finish
before starting the SSE observer. The bot and observer now start independently.

**Check:**

```bash
docker logs --since 10m tg-bridge 2>&1 | grep -E 'completion|event stream'
```

Look for `completion delivered …`. If you see `completion history failed` or
`completion event stream error`, check OpenCode API connectivity:
`curl -u opencode:<password> http://192.0.2.221:28894/api/session?limit=1`.

## Voice message is ignored without a response

**Cause:** The handler previously supported only text, photos, and documents;
other message types were silently dropped.

**Fix:** Unsupported media now receives a clear response. Voice messages are
transcribed when the Whisper service is configured.

## The bot is silent in a group

This is expected. The bot accepts commands only from the owner in their private
chat. Commands and buttons are ignored in groups, even if the owner is a member,
to avoid exposing paths, responses, and approval requests to other participants.
Open a private chat with the bot.

## An old session cannot be found with `/sessions`

The list is paginated with 10 sessions per page. Use the `Next ›` inline button or
run `/sessions 12` to open page 12 directly.

## Voice transcription returns an unintelligible result or HTTP 500

**Cause:** `faster-whisper` calls `av.open(..., metadata_errors=...)`, but PyAV 19
does not accept that argument.

**Fix:** Audio decoding uses `ffmpeg` → float32 (`voice-service/server.py`),
avoiding this PyAV version incompatibility.

**Check the service:**

```powershell
curl.exe -s -X POST -H "x-whisper-token: <token>" -F "file=@sample.ogg;type=audio/ogg" http://127.0.0.1:28895/transcribe
```

## Approval cards do not arrive

**Cause:** The bot used to poll `GET /api/permission/request`, which returns an
empty list associated with another working directory. Pending requests are
session-specific and are available from `GET /api/session/{id}/permission`.

**Fix:** The bot polls the active session list (`GET /api/session/active`), then
queries each session. Button keys are short numbers mapped in memory.

**Check without Telegram:**

```bash
ssh root@192.0.2.12 'docker exec tg-bridge node --input-type=module -e "
import { pollPermissionCards } from "/app/src/permissions.js"
import { createClient } from "/app/src/api.js"
const c = createClient({ url: process.env.OPENCODE_URL, password: process.env.OPENCODE_TOKEN })
console.log(await pollPermissionCards({ client: c, ownerID: 1, cards: new Map(), seen: new Set(), sendMessage: async (a,b)=>console.log(b) }))
"'
```

## Pressing an approval button returns HTTP 400

**Cause:** The request used the `reply` field, but the API expects `decision`
(`once | always | reject`).

**Fix:** `src/api.js` sends `{decision}`; a test checks the request body.

## A completion is repeated after restart, or a new one is missing

**Cause:** Completion cursors are stored in `/data/state.json` on the `tg-state`
volume. If the volume is deleted or state is not saved, the bot loses track of
which `idle/succeeded` events it has already notified.

**Check and recover:**

```bash
docker exec tg-bridge cat /data/state.json
```

`completionInitialized` should be `true`, and `completionCursors` should contain
the last delivered `completionID` for each session. Do not delete the `tg-state`
volume. If a turn finished while the bot was restarting, it reconciles history
and sends the missed completion. For long messages, `completionDeliveryParts`
stores the next part so a normal Telegram error can retry without repeating parts
already confirmed as delivered. A timeout after Telegram accepts a message may
still cause one part to be repeated.

## The bot stops responding after the Windows server IP changes

**Cause:** `portproxy` listens on the specific address `192.0.2.221`.

**Fix:** Restore that address or update the rule:

```powershell
netsh interface portproxy show v4tov4
netsh interface portproxy delete v4tov4 listenaddress=<old-address> listenport=28894
```

## Useful commands

```powershell
# Show established API connections
Get-NetTCPConnection -LocalPort 28894 -State Established

# Show port forwarding and firewall rules
netsh interface portproxy show v4tov4
Get-NetFirewallPortFilter -Protocol TCP | Where-Object LocalPort -eq 28894 |
  ForEach-Object { $_ | Get-NetFirewallRule | Select DisplayName,Action,Enabled }

# Show recent container errors
docker logs --since 1h tg-bridge 2>&1 | grep -Ei 'failed|error' | tail -20
```
