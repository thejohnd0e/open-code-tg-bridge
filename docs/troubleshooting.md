# Что уже ломалось и как это искать

Все случаи ниже произошли вживую 2026-11-03, во время первой приёмки.

## Итог после завершения не приходит в Telegram

**Симптом.** Ход OpenCode завершился, но нет сообщения `✅ Всё сделано, готово`.

**Причина.** До исправления `index.js` ждал завершения long polling при запуске
бота и не запускал SSE-наблюдатель. Теперь бот и наблюдатель стартуют независимо.

**Проверка:**

```bash
docker logs --since 10m tg-bridge 2>&1 | grep -E 'completion|event stream'
```

Ожидается `completion delivered …`. Если видны `completion history failed` или
`completion event stream error`, проверьте доступность OpenCode API
(`curl -u opencode:<пароль> http://192.0.2.1:28894/api/session?limit=1`).

## Голосовое игнорируется без ответа

**Причина.** Обработчик знал только текст, фото и документы; всё остальное
молча отбрасывалось.

**Лечение.** Любой неподдерживаемый тип получает понятный ответ. После
подключения Whisper голосовые распознаются.

## Бот молчит в группе

Это ожидаемо: бот разрешает команды только от владельца в его личном чате. Даже
если владельца добавить в группу, команды и кнопки игнорируются, чтобы не
публиковать пути, ответы и подтверждения участникам чата. Откройте личный чат с
`@ExampleBot`.

## Не удаётся найти старую сессию через `/sessions`

Список разбит на страницы по 10 сессий. Нажмите inline-кнопку `Далее ›` под
списком или вызовите `/sessions 12`, чтобы сразу открыть страницу 12.

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

## После перезапуска старый итог пришёл повторно или новый пропал

**Причина.** Курсоры завершений хранятся в `/data/state.json` на томе `tg-state`.
Если том удалить или состояние не записывается, бот не знает, какие
`idle/succeeded` уже уведомлял.

**Проверка и лечение:**

```bash
docker exec tg-bridge cat /data/state.json
```

`completionInitialized` должен быть `true`, а `completionCursors` — содержать
последний доставленный `completionID` для сессий. Не удаляйте volume `tg-state`.
Если работа завершилась во время перезапуска, бот сверяет историю и досылает
пропущенные итоги. Для длинного текста `completionDeliveryParts` хранит номер
следующей части, чтобы при обычной ошибке Telegram продолжить без повтора уже
подтверждённых частей. Таймаут после фактического принятия Telegram может
неизбежно привести к повтору одной части.

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
