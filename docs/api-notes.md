# OpenCode API notes (v2.2.5, verified behavior)

Server: `http://127.0.0.1:28894` on the Windows server.

## Authentication

HTTP Basic, username `opencode`, password from the `password` field in
`~/.config/opencode/service.json`.

```bash
curl -u opencode:<password> http://127.0.0.1:28894/api/session?limit=1
```

Without the header, the server returns `401 {"_tag":"UnauthorizedError"}`.
`Authorization: Bearer`, `x-opencode-password`, and `x-opencode-token` do **not**
work.

## Endpoints used by the bot

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/session?limit=N` | Sessions across projects; each item includes `projectID`, `location.directory`, `model`, and `time.updated` |
| GET | `/api/session?limit=N&cursor=…` | Next session pages (`cursor.next`) |
| POST | `/api/session` | Create: `{title, location:{directory}, model:{providerID,id}, permissions?}` |
| DELETE | `/api/session/{id}` | Delete a session |
| POST | `/api/session/{id}/prompt` | Send `{text, files?, delivery?}`; returns immediately with the queued item |
| GET | `/api/session/{id}/message?limit=N` | Message history |
| GET | `/api/session/{id}/message?limit=N&cursor=…` | Next history pages |
| GET | `/api/session/active` | Map such as `{sessionID: {type:"running"}}` |
| GET | `/api/session/{id}/permission` | **Pending approvals for this session** |
| POST | `/api/session/{id}/permission/{requestID}/reply` | Submit a `{decision}` |
| GET | `/api/event` | SSE event stream |

## Attachments

In a `prompt` request, a file is sent as:

```json
{ "name": "photo.jpg", "uri": "data:image/jpeg;base64,<…>", "source": { "type": "inline" } }
```

Sender and receiver disks are irrelevant because the content is embedded in the
request. A live test confirmed that a 5 MB photo was added to a session as an
image and described by the model.

## Replying to an approval

```json
{ "decision": "once" }     // or "always" or "reject"
```

The `reply` field returns **400**. This was found in a live test: unit tests had
validated the client's own assumption, not the API contract.

## Pending approvals

`GET /api/permission/request` returns
`{"location":{"directory":…},"data":[]}`—an empty list associated with the
process working directory. Actual requests are session-specific:
`GET /api/session/{id}/permission`.

Example request:

```json
{
  "id": "per_…", "sessionID": "ses_…", "action": "shell",
  "resources": ["whoami"], "save": ["whoami *"],
  "source": { "type": "tool", "messageID": "msg_…", "id": "functions.shell:0" }
}
```

## Event stream (`GET /api/event`)

SSE uses `data: {json}` lines separated by `: heartbeat` lines. Example:

```json
{ "id": "evt_…", "created": 1700000000000,
  "type": "session.text.delta",
  "location": { "directory": "D:\\…" },
  "data": { "sessionID": "ses_…", "assistantMessageID": "msg_…", "ordinal": 0, "delta": "Hello" } }
```

Observed types include `session.text.started|delta|ended` (the `ended` event also
contains the complete `text`), `session.step.started|streamed|ended`,
`session.execution.started|succeeded`, `session.inbox.enqueued|delivered`,
`session.reasoning.*`, `session.tool.*`, `shell.exited`, and `server.connected`.

## Session model

Creating a session with `POST /api/session` and `model` applies the model; the
created session reports `opencode-go/gpt-6-luna`. `session.update` has no model
field, so it cannot be used to change the model.

## Permissions (ruleset)

The format is an array of rules:

```json
[{ "action": "*", "resource": "*", "effect": "allow" },
 { "action": "read", "resource": "*.env", "effect": "ask" }]
```

Pass it when creating a session (`permissions`). `effect: "ask"` pauses the agent
and requests approval; this was used to test Telegram approval cards.

## Miscellaneous

- A prompt returns `Session.Inbox.User`: the message is queued, but the turn is
  still running.
- Session-list and message-history responses contain `{data, cursor}`. To fetch
  everything, repeat the request with `cursor.next` until it is `null`. The bridge
  does this when recovering notifications after a long disconnect.
- `opencode api GET /openapi.json` returns the full schema through the
  authenticated CLI; a normal `curl` request to `/openapi.json` returns 401.
- `opencode api` is a convenient way to call any endpoint, for example
  `opencode api GET /api/session`.
