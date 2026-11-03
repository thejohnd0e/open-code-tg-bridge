# Факты об API OpenCode (v2.2.5), добытые опытом

Сервер: `http://127.0.0.1:28894` на Windows-сервере.

## Авторизация

HTTP Basic, логин `opencode`, пароль — поле `password` в
`~/.config/opencode/service.json`.

```bash
curl -u opencode:<пароль> http://127.0.0.1:28894/api/session?limit=1
```

Без заголовка — `401 {"_tag":"UnauthorizedError"}`. `Authorization: Bearer`,
`x-opencode-password` и `x-opencode-token` **не** работают.

## Эндпоинты, которыми пользуется бот

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/session?limit=N` | сессии всех проектов; в элементе есть `projectID`, `location.directory`, `model`, `time.updated` |
| POST | `/api/session` | создать: `{title, location:{directory}, model:{providerID,id}, permissions?}` |
| DELETE | `/api/session/{id}` | удалить сессию |
| POST | `/api/session/{id}/prompt` | отправить: `{text, files?, delivery?}`; отвечает сразу очередью |
| GET | `/api/session/{id}/message?limit=N` | история сообщений |
| GET | `/api/session/active` | карта `{sessionID: {type:"running"}}` |
| GET | `/api/session/{id}/permission` | **ожидающие подтверждения этой сессии** |
| POST | `/api/session/{id}/permission/{requestID}/reply` | решение: `{decision}` |
| GET | `/api/event` | SSE-поток событий |

## Вложения

В запросе `prompt` файл передаётся так:

```json
{ "name": "photo.jpg", "uri": "data:image/jpeg;base64,<…>", "source": { "type": "inline" } }
```

Диски отправителя и получателя значения не имеют — содержимое внутри запроса.
Проверено живьём: фото 5 МБ легло в сессию как изображение, модель его описала.

## Ответ на подтверждение

```json
{ "decision": "once" }     // или "always", или "reject"
```

Поле `reply` даёт **400**. Это стоило одного живого теста: юнит-тесты проверяли
собственную договорённость, а не API.

## Ожидающие подтверждения

`GET /api/permission/request` возвращает `{"location":{"directory":…},"data":[]}` —
пустой список, привязанный к каталогу процесса. Реальные запросы лежат только
по сессии: `GET /api/session/{id}/permission`.

Пример запроса:

```json
{
  "id": "per_…", "sessionID": "ses_…", "action": "shell",
  "resources": ["whoami"], "save": ["whoami *"],
  "source": { "type": "tool", "messageID": "msg_…", "id": "functions.shell:0" }
}
```

## События потока (`GET /api/event`)

SSE: строки `data: {json}`, между ними `: heartbeat`. Формат события:

```json
{ "id": "evt_…", "created": 1700000000000,
  "type": "session.text.delta",
  "location": { "directory": "D:\\…" },
  "data": { "sessionID": "ses_…", "assistantMessageID": "msg_…", "ordinal": 0, "delta": "Hello" } }
```

Замеченные типы: `session.text.started|delta|ended` (в `ended` приходит и полный
`text`), `session.step.started|streamed|ended`, `session.execution.started|succeeded`,
`session.inbox.enqueued|delivered`, `session.reasoning.*`, `session.tool.*`,
`shell.exited`, `server.connected`.

## Модель сессии

`POST /api/session` с `model` применяет модель: созданная сессия отчитывается
`opencode-go/gpt-6-luna`. В `session.update` поля модели нет — менять её этим
методом нельзя.

## Права (ruleset)

Формат — массив правил:

```json
[{ "action": "*", "resource": "*", "effect": "allow" },
 { "action": "read", "resource": "*.env", "effect": "ask" }]
```

Передаётся при создании сессии (`permissions`). `effect: "ask"` заставляет агента
остановиться и запросить подтверждение — так проверялась карточка в Telegram.

## Мелочи

- Промпт возвращает `Session.Inbox.User` — сообщение уже в очереди, ход ещё идёт.
- `opencode api GET /openapi.json` отдаёт полную схему (через CLI, с авторизацией);
  обычный `curl` к `/openapi.json` возвращает 401.
- `opencode api` — удобный способ дёргать любой эндпоинт: `opencode api GET /api/session`.
