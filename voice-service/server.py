import os
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel

BASE = Path(__file__).resolve().parent
TOKEN = os.environ.get("WHISPER_TOKEN") or (BASE / "token.txt").read_text(encoding="utf-8").strip()
MODEL_NAME = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
DEVICE = os.environ.get("WHISPER_DEVICE", "cuda")
COMPUTE = os.environ.get("WHISPER_COMPUTE", "float16" if DEVICE == "cuda" else "int8")

app = FastAPI(title="whisper-local")
model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)


@app.get("/healthz")
def healthz():
    return {"ok": True, "model": MODEL_NAME, "device": DEVICE}


def decode_to_float32(path: str) -> np.ndarray:
    """Decode any container to 16 kHz mono float32 with ffmpeg.

    faster-whisper's own decoder goes through PyAV, whose `av.open` signature
    has been churning; feeding samples directly keeps us independent of it.
    """
    result = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr.decode('utf-8', 'replace')[:200]}")
    return np.frombuffer(result.stdout, np.int16).astype(np.float32) / 32768.0


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), x_whisper_token: str | None = Header(default=None)):
    if not TOKEN or x_whisper_token != TOKEN:
        raise HTTPException(status_code=401, detail="bad token")
    suffix = Path(file.filename or "voice.ogg").suffix or ".ogg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
        handle.write(await file.read())
        path = handle.name
    try:
        audio = decode_to_float32(path)
        segments, info = model.transcribe(audio, vad_filter=True, beam_size=5)
        text = "".join(segment.text for segment in segments).strip()
    finally:
        os.unlink(path)
    return {"text": text, "language": info.language, "duration": round(info.duration, 2)}
