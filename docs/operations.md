# Эксплуатация

## Здоровье

```bash
docker ps --filter name=tg-bridge            # Up (healthy)
docker exec tg-bridge node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>r.text()).then(console.log)"
```

`healthz` отвечает `ok`, даже если Telegram или OpenCode недоступны: контейнер
жив, а ошибки видны в логе. Так сделано намеренно — иначе плохой токен вызывал
бы цикл перезапусков.

## Логи

```bash
docker logs --since 30m tg-bridge 2>&1 | tail -50
docker logs -f tg-bridge
```

Что искать:

| Строка | Значение |
|---|---|
| `bot started` | запуск бота |
| `unauthorized user_id=N` | писал чужой аккаунт (или владелец до привязки) |
| `completion delivered …` | итог по завершённой сессии ушёл в Telegram |
| `completion send failed for ses_…` | Telegram не принял итог; курсор не сдвинут, повтор будет при периодической sync или reconnect |
| `completion history failed for ses_…` | не удалось прочитать историю этой сессии для восстановления |
| `completion event failed for ses_…` | обработка события завершения завершилась ошибкой |
| `completion tracker stopped: …` | трекер неожиданно остановился; контейнер остаётся жив, проверьте ошибку рядом |
| `completion event stream error: …` | поток событий оборвался, будет переподключение |
| `handler failed: …` | ошибка обработчика |
| `transcribe failed: …` | не сработало распознавание |

Непосредственные промежуточные сообщения не пересылаются: успех фиксируется
одной строкой `completion delivered` на каждую сессию/завершение. История
повторно сверяется раз в 30 секунд; при сбое Telegram доставка повторяется без
ожидания разрыва SSE.

## Обновление версии

```bash
# локально: тесты
cd telegram-bridge && npm test

# перенос и сборка
tar -czf tgbridge.tgz package.json package-lock.json src Dockerfile compose.yaml .env.example
scp tgbridge.tgz root@192.0.2.1:/root/
ssh root@192.0.2.1 'tar -xzf /root/tgbridge.tgz -C /root/TgBridge && cd /root/TgBridge && docker compose build && docker compose up -d --no-build'
```

`--force-recreate` нужен, если менялся `.env`: переменные читаются только при
создании контейнера.

## Keyboard and session list

The persistent keyboard appears after `/start` or `/help`. `/sessions` shows 10
sessions per page: use `‹ Previous` / `Next ›` to navigate, or `/sessions N` to
open page N directly. The bot only handles the owner's private chat; owner
commands in groups are ignored too. All bot-authored interface text is English;
OpenCode-authored response content is passed through unchanged.

## Перезапуск

```bash
docker restart tg-bridge         # состояние и выбранная сессия сохраняются
```

После старта бот сверяется с историей сессии и досылает только пропущенное:
ответ, пришедший во время перезапуска, доходит один раз.

## Резервная копия состояния

```bash
docker exec tg-bridge cat /data/state.json > state-backup.json
```

Восстановление — положить файл обратно в том и перезапустить контейнер.
Ничего секретного в нём нет: только id сессий и курсор.

## Секреты

| Что | Где |
|---|---|
| Токен бота | `/root/TgBridge/.env` (600) на Linux host |
| Пароль API OpenCode | там же, и в `~/.config/opencode/service.json` на Windows |
| Токен распознавания | там же, и в `C:/Example/Project` |

В git не попадают: `.env` в `.gitignore`.
