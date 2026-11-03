# Local voice transcription

This service transcribes Telegram voice messages. It runs on the Windows server
and uses the GPU for inference.

## Why Windows instead of Linux host

The Windows server has an CPU, ample memory, and an available GPU. Linux host has
network services and also runs the proxy and monitoring. In a measured test, 6.6 seconds
of audio took about one second to transcribe on the GPU; CPU inference would take
several times longer.

## Components

| File | Purpose |
|---|---|
| `voice-service/server.py` | FastAPI endpoints: `POST /transcribe`, `GET /healthz` |
| `voice-service/start.cmd` | Starts uvicorn with CUDA library paths |
| `C:/Example/Project` | Access token (not in Git) |
| `C:/Example/Project` | Service log |

The model is `large-v3-turbo` (CTranslate2), device `cuda`, `compute_type=float16`,
with `beam_size=5` and VAD enabled. If CUDA is unavailable, set
`WHISPER_DEVICE=cpu` and `WHISPER_COMPUTE=int8`.

## Install

```powershell
cd C:/Example/Project
python -m venv .venv
.\.venv\Scripts\pip install faster-whisper fastapi "uvicorn[standard]" python-multipart nvidia-cublas-cu12 nvidia-cudnn-cu12 "av>=14"
# Store a 32-character hexadecimal token in token.txt
```

`start.cmd` adds the `cublas\bin` and `cudnn\bin` directories from
`site-packages\nvidia` to `PATH`; without them, `ctranslate2` cannot find its DLLs.

## Start automatically

```powershell
schtasks /Create /TN "Whisper local" /TR "C:/Example/Project" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
```

The task runs as `SYSTEM`, so it survives RDP sign-out. A real server reboot has
not yet been tested (see `TODO.md`).

## Access from the container

```powershell
netsh interface portproxy add v4tov4 listenaddress=192.0.2.1 listenport=28895 connectaddress=127.0.0.1 connectport=28895
New-NetFirewallRule -DisplayName "Whisper for the Linux host" -Direction Inbound -Protocol TCP -LocalPort 28895 -RemoteAddress 192.0.2.1 -Action Allow
```

Check from Linux host:
`curl -s -o /dev/null -w '%{http_code}\n' http://192.0.2.1:28895/healthz`
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
