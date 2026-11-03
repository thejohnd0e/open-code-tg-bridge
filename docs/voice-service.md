# Локальное распознавание речи

Сервис превращает голосовые сообщения Telegram в текст. Работает на
Windows-сервере, модель считает на видеокарте.

## Почему на Windows, а не на Linux host

На Windows-сервере CPU, ample memory и available GPU; на Linux host сетевые сервисы,
и там же живут прокси и мониторинг. Замер: 6,6 секунды речи распознаются за
~1 секунду на GPU. На CPU это заняло бы в разы дольше.

## Состав

| Файл | Что делает |
|---|---|
| `voice-service/server.py` | FastAPI: `POST /transcribe`, `GET /healthz` |
| `voice-service/start.cmd` | запуск uvicorn с путями к CUDA-библиотекам |
| `C:/Example/Project` | токен доступа (в git не попадает) |
| `C:/Example/Project` | лог сервиса |

Модель `large-v3-turbo` (CTranslate2), устройство `cuda`, `compute_type=float16`,
`beam_size=5`, VAD включён. Если CUDA недоступна, задайте
`WHISPER_DEVICE=cpu` и `WHISPER_COMPUTE=int8`.

## Установка

```powershell
cd C:/Example/Project
python -m venv .venv
.\.venv\Scripts\pip install faster-whisper fastapi "uvicorn[standard]" python-multipart nvidia-cublas-cu12 nvidia-cudnn-cu12 "av>=14"
# токен: 32 hex-символа в token.txt
```

`start.cmd` добавляет в `PATH` каталоги `cublas\bin` и `cudnn\bin` из
`site-packages\nvidia` — без этого `ctranslate2` не находит DLL.

## Автозапуск

```powershell
schtasks /Create /TN "Whisper local" /TR "C:/Example/Project" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
```

Задача от `SYSTEM`, поэтому переживает выход из сеанса RDP. После реальной
перезагрузки сервера это ещё не проверялось (см. `TODO.md`).

## Доступ из контейнера

```powershell
netsh interface portproxy add v4tov4 listenaddress=192.0.2.1 listenport=28895 connectaddress=127.0.0.1 connectport=28895
New-NetFirewallRule -DisplayName "Whisper for the Linux host" -Direction Inbound -Protocol TCP -LocalPort 28895 -RemoteAddress 192.0.2.1 -Action Allow
```

Проверка с Linux host: `curl -s -o /dev/null -w '%{http_code}\n' http://192.0.2.1:28895/healthz`
→ `200`.

## API

```
POST /transcribe
  headers: x-whisper-token: <токен>
  multipart: file=@voice.ogg;type=audio/ogg
  → {"text": "…", "language": "ru", "duration": 6.62}

GET /healthz → {"ok": true, "model": "large-v3-turbo", "device": "cuda"}
```

## Что важно знать

- Декодирование аудио идёт через `ffmpeg` (`C:\Windows\ffmpeg.exe`), а не через
  PyAV: у `faster-whisper` с PyAV 19 несовместимость аргументов.
- Ограничение Telegram: бот скачивает файлы до 20 МБ; голосовые почти всегда
  далеко ниже.
- Точность не идеальная: на первом живом тесте «голосовому» распозналось как
  «кликовому». Если понадобится лучше — `initial_prompt` с терминами, модель
  `large-v3` (медленнее) или языковая подсказка вместо автоопределения.
- Сервис не хранит аудио: временный файл удаляется сразу после распознавания.
