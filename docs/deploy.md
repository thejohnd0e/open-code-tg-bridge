# Развёртывание

Что должно быть заранее: SSH-доступ к Linux host (192.0.2.1), администратор на
Windows-сервере (`192.0.2.1`), созданный у @BotFather бот.

## 1. Проброс API OpenCode в локальную сеть

На Windows-сервере, от администратора:

```powershell
netsh interface portproxy add v4tov4 listenaddress=192.0.2.1 listenport=28894 connectaddress=127.0.0.1 connectport=28894
New-NetFirewallRule -DisplayName "OpenCode API for the Linux host" -Direction Inbound -Protocol TCP -LocalPort 28894 -RemoteAddress 192.0.2.1 -Action Allow
```

Проверка с Linux host (пароль — из `~/.config/opencode/service.json`, поле `password`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -u 'opencode:<пароль>' 'http://192.0.2.1:28894/api/session?limit=1'
```

Ожидается `200`. Если `000` — не запущен `iphlpsvc` или адрес в правиле не тот.

## 2. Каталог и `.env` на Linux host

```bash
mkdir -p /root/TgBridge
# файлы проекта: package.json, package-lock.json, src/, Dockerfile, compose.yaml
```

`/root/TgBridge/.env`, права `600`, в git не попадает:

```
TELEGRAM_BOT_TOKEN=<токен от BotFather>
OPENCODE_URL=http://192.0.2.1:28894
OPENCODE_TOKEN=<пароль из service.json>
OWNER_TELEGRAM_ID=
LIGHT_DIR=C:/Example/Project
LIGHT_MODEL=opencode-go/gpt-6-luna
WHISPER_URL=http://192.0.2.1:28895
WHISPER_TOKEN=<токен сервиса распознавания>
```

Токен и пароль в чат и в переписку не присылать: переносить файлом и затирать
после (`shred -u`).

## 3. Сборка и первый запуск

```bash
cd /root/TgBridge
docker compose build
docker compose up -d --no-build
docker logs -f tg-bridge
```

В логе должно появиться `bot started` и `healthz on 8080`.

## 4. Привязка владельца

Пока `OWNER_TELEGRAM_ID` пуст, бот молчит для всех и пишет id в лог. Напишите
боту `/start` и найдите строку:

```bash
docker logs tg-bridge 2>&1 | grep unauthorized | tail -1
# unauthorized user_id=123456789
```

Впишите число в `.env` и пересоздайте контейнер:

```bash
sed -i 's|^OWNER_TELEGRAM_ID=.*|OWNER_TELEGRAM_ID=123456789|' /root/TgBridge/.env
docker compose up -d --no-build --force-recreate
```

## 5. Голосовое распознавание

См. [voice-service.md](voice-service.md). Без него бот отвечает на голосовые
понятной ошибкой, остальное работает.

## 6. Проверка

1. С чужого аккаунта — тишина.
2. `/sessions` — список проектов.
3. Фото 5 МБ — модель описывает картинку.
4. `/new`, затем просьба «напиши 6000 символов» — ответ частями.
5. Голосовое — приходит расшифровка и сообщение в сессии.
6. Подтверждение: сессия с `permissions: [{action:"*",resource:"*",effect:"ask"}"]`
   даёт карточку с кнопками, «Запретить» отменяет инструмент.

## Зависимости, о которых легко забыть

- `192.0.2.1` должен быть **постоянным**: `portproxy` привязан к адресу.
  Сменится адрес — бот потеряет API и распознавание.
- Правило брандмауэра разрешает один адрес; при переезде Linux host на другой IP
  править нужно и его, и `-RemoteAddress`.
