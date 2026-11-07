# Telegram as a persistent interface to OpenCode — design

Date: 2026-11-03. Status: original design; notification behavior was superseded
by the [current architecture](architecture.md).

## Purpose

Access OpenCode from a phone: send a photo, file, or note to any session in any
project, read the response, and approve a potentially dangerous command. Telegram
is another client for the same server used by TUI and RDP, not a separate
“pocket bot.”

## Verified on the live system

- The Windows server runs OpenCode v2.2.5, listening on `127.0.0.1:28894`; without
  a token, it returns 401. The token is in `~/.config/opencode/service.json`
  (`password` field).
- Server authentication is HTTP Basic, username `opencode`, password from
  `service.json` (`curl -u opencode:<password> ...` returns 200; without it, 401).
- The API provides the required functionality:
  - `GET /api/session` lists sessions with `projectID` and `location` across all
    projects.
  - `POST /api/session` (`session.create`) creates a session in a directory; the
    model is set separately through `session.update`.
  - `POST /api/session/{id}/prompt` submits a prompt and immediately returns the
    queued inbox item (`Session.Inbox.User`); the caller does not wait for the turn
    to finish.
  - `GET /api/session/{id}/inbox`, `DELETE .../inbox/{inboxID}`, and
    `PATCH .../inbox/{inboxID}` (switch `steer|queue`) manage queued work and
    cancellation.
  - `POST /api/session/{id}/inbox` accepts a user message `{text, files[]}`;
    files are base64 encoded (`source: inline`), so sender and receiver disks do
    not need to match.
  - `GET /api/session/{id}/message` returns message history.
  - `GET /api/event` provides **SSE** lines such as
    `data: {"id","type","data","location"}` and `: heartbeat`; event types
    such as `server.connected` and `shell.exited` are available for session
    monitoring.
  - `GET /api/session/{id}/permission` and
    `POST /api/session/{id}/permission/{requestID}/reply` support the approval
    decisions `once | always | reject`.
- `api.telegram.org` is reachable from Windows (302) and from the Linux host (302 in
  0.55 seconds); no proxy is required in this environment.
- The Bot API allows the bot to download files up to 20 MB; base64 adds about 33%.
- Lower-cost models that accept images include `gpt-6-luna` (0.10 / 0.50 USD per
  million tokens, text + image + PDF), `claude-haiku-5-5`, `glm-5.3-flash`, and
  `qwen3.8-flash`.

## Version 1 goals

1. Listen to exactly one Telegram account: the owner. Other IDs receive no reply,
   file, or session list; only a log entry is created.
2. `/sessions` lists sessions across all projects (title, project, time) and lets
   the owner select one by button or number; `/status` shows the current selection.
3. After selection, text, photos, and documents are sent to that session; agent
   responses arrive in the chat and long responses are split into parts.
4. Monitoring also works when work is done through TUI/RDP: messages from the
   selected session are forwarded to Telegram.
5. Approval requests arrive as messages with **Allow**, **Always allow**, and
   **Reject** buttons, calling `permission/{id}/reply`.
6. `/new` creates a separate lightweight session using `gpt-6-luna` in a neutral
   directory.

## Not goals for version 1

Interactive forms (`/form`), voice transcription, multiple users, webhooks,
forwarding files from a session back to Telegram, or a full TUI in chat.

## Anti-goals

Making the bot accessible to other accounts or groups; committing tokens;
exposing the OpenCode API to the internet; silently auto-approving instead of
requiring explicit approval.

## Constraints

- Sessions live on the Windows server. If it is unavailable, the bot reports that
  the server is unavailable rather than pretending to be the agent.
- Bot API file limit is 20 MB (about 15 MB in practice after base64 overhead).
  Larger files must be referenced by a server path, for example, “attach
  `D:\...`.”
- There is no public address or certificate, so use long polling rather than a
  webhook.

## Architecture

- The `tg-bridge` container runs Node 22 + grammY on the Linux host (`192.0.2.12`), with
  Docker Compose under `/root/TgBridge/` and `restart: unless-stopped`.
- The Windows OpenCode server listens on the LAN through
  `opencode serve --hostname <lan-ip> --port 28894 --service`; the firewall allows
  only `192.0.2.12`, and HTTP Basic authentication is required
  (`opencode:<password from service.json>`). A reverse SSH tunnel was considered
  and rejected because it adds a process that must be supervised after reboots.
- State (owner, selected session, `update_id`, and SSE cursor) is JSON on a Docker
  volume.
- Secrets are stored in `.env` alongside Compose (permissions `600`), not in Git:
  `TELEGRAM_BOT_TOKEN`, `OPENCODE_TOKEN`, `OWNER_TELEGRAM_ID`, and `OPENCODE_URL`.

## Decisions

- The bot runs on the Linux host, not Windows, at the owner's request: Docker, logs, and
  automatic restarts. The tradeoff is LAN access to the API, restricted by IP.
- Lightweight sessions use `gpt-6-luna` and a configurable empty
  directory outside any working project.
- The owner is configured in `.env`. Until the ID matches, the bot stays silent
  and logs the ID so the owner can identify it.
- Approvals require explicit buttons; they never auto-approve after a timeout.
- **Approvals are monitored across all sessions**, not only the selected one. Each
  card includes the project and session name, so an agent in another project does
  not have to wait for the owner to return to RDP. A request approved in TUI is
  treated as resolved and is not sent again.
- **Restarts should neither lose nor duplicate work:** event cursors are persisted
  and only missed completions are delivered after startup, including responses
  completed while the bot was restarting.

## Originally open implementation choices

The Telegram client and long-message splitting, state/cursor format, retry and
rate-limit behavior, log and health-check format, approval card layout, and
handling of photo albums and captions were left to implementation.

## Acceptance checks

1. A different Telegram account gets no response; its ID is logged.
2. `/sessions` shows sessions from multiple projects; selecting one changes the
   target.
3. A roughly 5 MB Telegram photo is available in the selected session.
4. An agent response appears in chat; a long response is split in order.
5. An approval request arrives with buttons; **Reject** cancels the operation and
   **Always allow** stops asking about that tool. Requests from another session
   also arrive with the project name.
6. Restarting the container preserves the selected session; a response completed
   during downtime arrives once after startup.
7. `/new` creates a session in the configured lightweight-session directory with `gpt-6-luna`, and a
   photo sent to it is stored in that directory.
