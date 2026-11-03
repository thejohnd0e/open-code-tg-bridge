# Что уже ломалось и как это искать

Все случаи ниже произошли вживую 2026-11-03, во время первой приёмки.

## Ответы не приходят в Telegram, хотя сообщения доходят

**Симптом.** Пишете боту — сообщение появляется в сессии, ответа в чате нет.
В логе ни одной строки про `mirror`.

**Причина.** `index.js` делал `await start()` (запуск бота), а long polling не
завершается никогда — до `mirror.start()` дело не доходило.

**Лечение.** `startServices` запускает зеркало и бота независимо; тест
«зеркало стартует, даже если запуск бота не завершается» это фиксирует.

**Как проверить, что зеркало живое:**

```bash
Get-NetTCPConnection -LocalPort 28894 -State Established |
  Where-Object { $_.RemoteAddress -eq '192.0.2.1' }
```

Должно быть устойчивое соединение (это SSE) плюс короткие (опросы).

## Голосовое игнорируется без ответа

**Причина.** Обработчик знал только текст, фото и документы; всё остальное
молча отбрасывалось.

**Лечение.** Любой неподдерживаемый тип получает понятный ответ. После
подключения Whisper голосовые распознаются.

## Голосовое «не разобрал» или сервис отвечает 500

**Причина.** `faster-whisper` зовёт `av.open(..., metadata_errors=...)`, а PyAV 19
такого аргумента не знает.

**Лечение.** Декодирование вынесено в `ffmpeg` → float32
(`voice-service/server.py`), зависимость от версии PyAV исчезла.

**Проверка сервиса:**

```powershell
curl.exe -s -X POST -H "x-whisper-token: <токен>" -F "file=@sample.ogg;type=audio/ogg" http://127.0.0.1:28895/transcribe
```

## Карточки подтверждений не приходят

**Причина.** Бот опрашивал `GET /api/permission/request` — этот эндпоинт отдаёт
пустой список и привязан к другому каталогу. Ожидающие подтверждения живут в
`GET /api/session/{id}/permission`, по сессии.

**Лечение.** Опрос идёт по списку активных сессий (`GET /api/session/active`),
затем по каждой сессии; ключ кнопки — короткое число из карты в памяти.

**Проверка без Telegram:**

```bash
ssh root@192.0.2.1 'docker exec tg-bridge node --input-type=module -e "
import { pollPermissionCards } from \"/app/src/permissions.js\"
import { createClient } from \"/app/src/api.js\"
const c = createClient({ url: process.env.OPENCODE_URL, password: process.env.OPENCODE_TOKEN })
console.log(await pollPermissionCards({ client: c, ownerID: 1, cards: new Map(), seen: new Set(), sendMessage: async (a,b)=>console.log(b) }))
"'
```

## Нажатие кнопки возвращает 400

**Причина.** Решение отправлялось полем `reply`, а API ждёт `decision`
(`once | always | reject`).

**Лечение.** `src/api.js` шлёт `{decision}`; тест проверяет тело запроса.

## После перезапуска ответ пропал или продублировался

**Причина.** Дедупликация сравнивала длину пришедшего куска с длиной уже
отправленного. При перезапуске посреди ответа в буфере оставался только хвост —
он считался «короче уже отправленного» и отбрасывался.

**Лечение.** Сравнивается полный текст сообщения, состояние занимается до
отправки и откатывается при ошибке. Сверка с историей выполняется **до** подписки
на поток, а не после паузы.

## Бот молчит после смены адреса Windows-сервера

**Причина.** `portproxy` слушает конкретный адрес `192.0.2.1`.

**Лечение.** Вернуть адрес или обновить правило:

```powershell
netsh interface portproxy show v4tov4
netsh interface portproxy delete v4tov4 listenaddress=<старый> listenport=28894
```

## Полезные команды

```bash
# кто вообще подключён к API
Get-NetTCPConnection -LocalPort 28894 -State Established

# правила проброса и брандмауэра
netsh interface portproxy show v4tov4
Get-NetFirewallPortFilter -Protocol TCP | Where-Object LocalPort -eq 28894 |
  ForEach-Object { $_ | Get-NetFirewallRule | Select DisplayName,Action,Enabled }

# последние ошибки в контейнере
docker logs --since 1h tg-bridge 2>&1 | grep -Ei 'failed|error' | tail -20
```
