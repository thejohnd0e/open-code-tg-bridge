# Telegram-мост к OpenCode — документация

Telegram-бот — второй интерфейс к OpenCode: с телефона можно выбрать любую
сессию любого проекта, отправить туда текст, фото, документ или голосовое,
получать итоговые уведомления по завершении любой сессии и подтверждать опасную
команду кнопкой.

## С чего начать

| Документ | О чём |
|---|---|
| [architecture.md](architecture.md) | как устроено: компоненты, потоки, порты, доступ |
| [deploy.md](deploy.md) | развернуть с нуля: сервер, `.env`, проброс портов, сборка |
| [operations.md](operations.md) | повседневная эксплуатация: логи, здоровье, обновление |
| [troubleshooting.md](troubleshooting.md) | что уже ломалось и как это искать |
| [voice-service.md](voice-service.md) | локальное распознавание речи (Whisper на GPU) |
| [api-notes.md](api-notes.md) | факты об API OpenCode, добытые опытом |
| [2026-11-03-telegram-bridge-design.md](2026-11-03-telegram-bridge-design.md) | дизайн: зачем, цели, ограничения |
| [2026-11-03-voice-design.md](2026-11-03-voice-design.md) | дизайн голосовых |
| [plans/2026-11-03-telegram-bridge.md](plans/2026-11-03-telegram-bridge.md) | план реализации |

## Коротко

- **Бот:** контейнер `tg-bridge` на Linux host (192.0.2.1), Node 22 + grammY, long polling.
- **Мозг:** сервер OpenCode на Windows-сервере, `127.0.0.1:28894`, опубликован в LAN
  через `netsh portproxy` на `192.0.2.1:28894`, брандмауэр пускает только `192.0.2.1`.
- **Голос:** `faster-whisper` `large-v3-turbo` на NVIDIA GPU, `127.0.0.1:28895`,
  опубликован так же на `192.0.2.1:28895`.
- **Доступ:** только `OWNER_TELEGRAM_ID`; остальным — молчание и строка в логе.
- **Состояние:** JSON на docker-томе `tg-state` (выбранная сессия, `update_id`, курсоры завершений по сессиям).
- **Tests:** `npm test` (`node --test`), 91 tests.

## Bot commands

```
/sessions — choose a session from any project (10 per page)
/status   — show the current session
/new      — create a lightweight session in C:/Example/Project on gpt-6-luna
/model    — change the selected session's model
/help     — show help
```

After `/start` or `/help`, Telegram shows a persistent keyboard with **Sessions**,
**New**, **Model**, **Status**, and **Help**. Slash command names stay unchanged.

Other text, photos, documents, and voice messages are sent to the selected session.
OpenCode-authored replies, project names, and session titles are passed through
unchanged. After a successful run, the bot sends one final notification with the
project and session names; progress messages are not forwarded. Long replies are
split into parts of up to 4096 characters.

