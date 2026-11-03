# tg-bridge — Telegram-интерфейс к OpenCode

Бот `@ExampleBot`: с телефона выбирает любую сессию любого проекта OpenCode,
передаёт туда текст, фото, документы и голосовые, присылает итог в Telegram при
успешном завершении любой сессии и показывает карточки подтверждений.

```bash
npm install
npm test        # node --test
```

Документация — в каталоге [`docs/`](docs/README.md):

- [архитектура](docs/architecture.md)
- [развёртывание](docs/deploy.md)
- [эксплуатация](docs/operations.md)
- [разбор поломок](docs/troubleshooting.md)
- [распознавание речи](docs/voice-service.md)
- [заметки об API OpenCode](docs/api-notes.md)

Дизайн и план: [docs/2026-11-03-telegram-bridge-design.md](docs/2026-11-03-telegram-bridge-design.md),
[docs/plans/2026-11-03-telegram-bridge.md](docs/plans/2026-11-03-telegram-bridge.md).

Сервис распознавания речи лежит в [`voice-service/`](voice-service/) — его
разворачивают на Windows-сервере рядом с OpenCode, отдельно от контейнера.
