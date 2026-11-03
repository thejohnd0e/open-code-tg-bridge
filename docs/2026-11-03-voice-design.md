# Voice messages: transcription on the Windows server

Date: 2026-11-03. Status: accepted and implemented.

## Goal

Instead of refusing Telegram voice messages, transcribe them and send the text to
the selected session as a regular message with a voice marker.

## Where to run inference

On a Windows host with an available NVIDIA GPU and ffmpeg. The Linux host also
handles network services, so keeping inference separate avoids resource contention.

## Design

- A local `faster-whisper` service (model `large-v3-turbo`, CUDA or CPU int8
  fallback) listens on `127.0.0.1:28895`. It provides `POST /transcribe` with a
  file and `x-whisper-token` header, plus `GET /healthz`.
- Container access uses `netsh portproxy` on port 28895 and a firewall rule that
  allows only the configured Linux host. Any `192.0.2.0/24` address in related
  examples is reserved for documentation and must be replaced for deployment.
- The bot downloads the voice message (ogg/opus) through the Bot API, sends it for
  transcription, and forwards the text to the session. If transcription fails,
  it returns a clear error instead of staying silent.
- The service token is stored in a local file, not Git; the bot token is in `.env`.

## Out of scope

Speaker diarization, timestamps in the response, manual language selection
(language is auto-detected), and retaining audio files after transcription.

## Acceptance checks

1. `POST /transcribe` with an ogg file returns text.
2. A Telegram voice message reaches the session as text.
3. If the service is unavailable, the bot reports an error and leaves the session
   unchanged.
