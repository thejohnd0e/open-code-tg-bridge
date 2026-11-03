# Deployment

Prerequisites: SSH access to the Linux host (`192.0.2.12`), administrator access
to the Windows host (`192.0.2.221`), and a bot created with @BotFather. The
`192.0.2.0/24` addresses in this guide are reserved documentation examples;
replace them with the addresses in your own environment.

## 1. Expose the OpenCode API on the LAN

Run as administrator on the Windows server:

```powershell
netsh interface portproxy add v4tov4 listenaddress=192.0.2.221 listenport=28894 connectaddress=127.0.0.1 connectport=28894
New-NetFirewallRule -DisplayName "OpenCode API for Linux host" -Direction Inbound -Protocol TCP -LocalPort 28894 -RemoteAddress 192.0.2.12 -Action Allow
```

Check from the Linux host (password is the `password` field in
`~/.config/opencode/service.json`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -u 'opencode:<password>' 'http://192.0.2.221:28894/api/session?limit=1'
```

Expected: `200`. If the result is `000`, `iphlpsvc` may not be running or the
address in the rule may be wrong.

## 2. Project directory and `.env` on the Linux host

```bash
mkdir -p /root/TgBridge
# Project files: package.json, package-lock.json, src/, Dockerfile, compose.yaml
```

Create `/root/TgBridge/.env` with permissions `600`; it must not be committed:

```
TELEGRAM_BOT_TOKEN=<BotFather token>
OPENCODE_URL=http://opencode.example.invalid:28894
OPENCODE_TOKEN=<password from service.json>
OWNER_TELEGRAM_ID=
LIGHT_DIR=C:/path/to/your/project
LIGHT_MODEL=opencode-go/gpt-6-luna
WHISPER_URL=http://whisper.example.invalid:28895
WHISPER_TOKEN=<transcription service token>
```

Do not send tokens or passwords in chat or messages. Transfer them as files and
securely remove the temporary copies afterward (for example, with `shred -u`).

## 3. Build and first startup

```bash
cd /root/TgBridge
docker compose build
docker compose up -d --no-build
docker logs -f tg-bridge
```

The logs should show `bot started` and `healthz on 8080`.

## 4. Set the owner

While `OWNER_TELEGRAM_ID` is empty, the bot ignores everyone and logs their ID.
Send `/start` to the bot and find the log entry:

```bash
docker logs tg-bridge 2>&1 | grep unauthorized | tail -1
# unauthorized user_id=123456789
```

Set that number in `.env` and recreate the container:

```bash
sed -i 's|^OWNER_TELEGRAM_ID=.*|OWNER_TELEGRAM_ID=123456789|' /root/TgBridge/.env
docker compose up -d --no-build --force-recreate
```

## 5. Voice transcription

See [voice-service.md](voice-service.md). Without it, the bot returns a clear
error for voice messages; other features continue to work.

## 6. Verification

1. A different account receives no response.
2. `/sessions` lists projects.
3. A 5 MB photo can be described by the model.
4. Use `/new`, then ask for a 6,000-character response; it should arrive in parts.
5. A voice message is transcribed and sent to the session.
6. A session with `permissions: [{action:"*",resource:"*",effect:"ask"}]`
   produces an approval card; **Reject** cancels the tool action.

## Easy-to-miss dependencies

- The Windows host address must remain **static** because `portproxy` binds to it.
  If it changes, the bot loses access to the API and transcription service.
- The firewall rule allows one source address. If the Linux host changes IP, update both
  the rule and its `-RemoteAddress` value.
