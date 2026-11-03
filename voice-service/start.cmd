@echo off
cd /d C:/Example/Project
set WHISPER_MODEL=large-v3-turbo
set WHISPER_DEVICE=cuda
set NVDIR=C:/Example/Project
set PATH=%NVDIR%\cublas\bin;%NVDIR%\cudnn\bin;%PATH%
".venv\Scripts\python.exe" -m uvicorn server:app --host 127.0.0.1 --port 28895 >> "C:/Example/Project" 2>&1
