# Local voice transcription

This service transcribes Telegram voice messages. It runs on a Windows host and
uses GPU acceleration when available.

## Why run transcription separately

Keeping transcription on a separate Windows host avoids competing with other
network services and allows the service to use an available GPU.

## Components

| File | Purpose |
|---|---|
| `voice-service/server.py` | FastAPI endpoints: `POST /transcribe`, `GET /healthz` |
| `voice-service/start.cmd` | Starts uvicorn with CUDA library paths |
| `voice-service/token.txt` | Access token (not in Git) |
| `voice-service/service.log` | Service log |

The model is `large-v3-turbo` (CTranslate2), device `cuda`, `compute_type=float16`,
with `beam_size=5` and VAD enabled. If CUDA is unavailable, set
`WHISPER_DEVICE=cpu` and `WHISPER_COMPUTE=int8`.

## Install

```powershell
$voiceDir = Join-Path $env:USERPROFILE 'OpenCode\whisper'
Set-Location $voiceDir
python -m venv .venv
.\.venv\Scripts\pip install faster-whisper fastapi "uvicorn[standard]" python-multipart nvidia-cublas-cu12 nvidia-cudnn-cu12 "av>=14"
# Store a 32-character hexadecimal token in token.txt
```

`start.cmd` adds the `cublas\bin` and `cudnn\bin` directories from
`site-packages\nvidia` to `PATH`; without them, `ctranslate2` cannot find its DLLs.

## Start automatically

```powershell
$startScript = Join-Path $env:USERPROFILE 'OpenCode\whisper\start.cmd'
$taskAction = "`"$startScript`""
schtasks /Create /TN "Whisper local" /TR $taskAction /SC ONSTART /RU SYSTEM /RL HIGHEST /F
```

The task runs as `SYSTEM`, so it survives RDP sign-out. A real server reboot has
not yet been tested (see `TODO.md`).

## Access from the container

The `192.0.2.0/24` addresses below are reserved documentation examples; replace
them with the Windows host and Linux host addresses in your environment.

```powershell
netsh interface portproxy add v4tov4 listenaddress=192.0.2.221 listenport=28895 connectaddress=127.0.0.1 connectport=28895
New-NetFirewallRule -DisplayName "Whisper for Linux host" -Direction Inbound -Protocol TCP -LocalPort 28895 -RemoteAddress 192.0.2.12 -Action Allow
```

Check from the Linux host:
`curl -s -o /dev/null -w '%{http_code}\n' http://192.0.2.221:28895/healthz`
should return `200`.

## API

```
POST /transcribe
  headers: x-whisper-token: <token>
  multipart: file=@voice.ogg;type=audio/ogg
  → {"text": "…", "language": "ru", "duration": 6.62}

GET /healthz → {"ok": true, "model": "large-v3-turbo", "device": "cuda"}
```

## Notes

- Audio is decoded with `ffmpeg` (`C:\Windows\ffmpeg.exe`), not PyAV: PyAV 19 is
  incompatible with arguments used by `faster-whisper`.
- The bot downloads files up to 20 MB from Telegram; voice messages are almost
  always much smaller.
- Transcription is not perfect. In the first live test, the Russian word for
  “voice message” was recognized as a different word. If accuracy needs improving,
  consider an `initial_prompt` with domain terms, the slower `large-v3` model, or
  specifying a language instead of auto-detection.
- The service does not retain audio; the temporary file is deleted immediately
  after transcription.
