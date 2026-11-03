@echo off
setlocal
cd /d "%~dp0"
set WHISPER_MODEL=large-v3-turbo
set WHISPER_DEVICE=cuda
set "NVDIR=%~dp0.venv\Lib\site-packages\nvidia"
set "PATH=%NVDIR%\cublas\bin;%NVDIR%\cudnn\bin;%PATH%"
".venv\Scripts\python.exe" -m uvicorn server:app --host 127.0.0.1 --port 28895 >> "%~dp0service.log" 2>&1
