<!-- START HERE, never here alone: read D:\Projects\Agent\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Discord bot module

Produced by plan `there-are-two-major-dazzling-corbato`, 2026-08-28.

Depends on [`module-system.md`](./module-system.md) — this is the first real
consumer of that hook API, and the thing that proves it is sufficient rather
than theoretical.

## Why

Two jobs:

1. **Outbound.** Echo household reminders and control events to Adeline's
   Discord DMs, so what the house did is legible away from the dashboard.
2. **Inbound.** Let a DM be interpreted as a dashboard command, without a chatty
   message ever becoming an action by accident — or, by default now, answered by
   Hermes so that a conversation started on a phone can be continued at a desk.

## Repository

Public GitHub repo `nova-module-discord`, separate from the Agent repo.

```
src/
  server.ts        register(api): hooks, queue, gateway, inbound
  client.ts        register(api): reminder editor fields, status panel
  discord/
    gateway.ts     identify / heartbeat / resume / backoff
    rest.ts        DM channel open, message send, interaction responses
  queue.ts
  inbound.ts       proposals, the rate limiter
  hermes-bridge.ts session links, chunking, which session a DM belongs to
  hermes-client.ts the Hermes WebUI client: login, new session, one turn
  agent-brief.ts   the fixed brief a fresh-DM session is given
  agent-jobs.ts    which agent handles a DM, the open-job store
  agent-flow.ts    submit, react, poll, deliver and link; server.ts only routes to it
  agent-runner-client.ts  the HTTP client for the runner's two job routes
runner/
  agent-runner.mjs   the service on Ununhexium that starts CLI sessions
  install-runner.ps1 registers it as a headless logon task
module.json
build.mjs          esbuild → dist/{server,client}.mjs
README.md
```

`npm run package` produces `nova-module-discord-<version>.zip` in the package
format from `module-system.md` §1, attached to a GitHub release. Its URL goes in
`dashboard.modules.defaults` so a fresh dashboard installs it unprompted.

**Because the repo is public**: no token, no guild id, no user id, no household
entity names, no host addresses. Those live in the dashboard's secrets store and
`config.json`. Check against the PRIVATEREF scrub rules before the first push.

## The Discord client

Hand-rolled, not `discord.js`. The needs are narrow — presence, DM send, button
interactions — and a minimal client bundles cleanly, which matters because the
package must inline all deps.

- **Gateway** (`wss://gateway.discord.gg/?v=10&encoding=json`): identify,
  heartbeat on the interval from `HELLO`, `RESUME` on resumable closes,
  capped exponential backoff (1 s → 60 s, full jitter) otherwise. Its only
  purposes are presence (the bot shows **Online**) and receiving
  `MESSAGE_CREATE` / `INTERACTION_CREATE`.
- **Intents**: `DIRECT_MESSAGES` and `GUILD_MESSAGES`. Message Content is **not**
  needed as a privileged intent — Discord always supplies content for DMs and
  for messages that mention the bot, which is the whole of what this reads.
- **REST** (`https://discord.com/api/v10`): `POST /users/@me/channels` to open
  the DM, `POST /channels/{id}/messages` to send, `PATCH /webhooks/…/messages/…`
  to edit a message after an interaction. Respects `X-RateLimit-*` and `429`
  `retry_after`.
- Bundles `ws` — the container is `node:22-trixie-slim` and has no stable global
  `WebSocket`.

`ws` is CommonJS and calls `require("events")`. Bundled into ESM that becomes a
dynamic require, which has no meaning in a module: the dashboard loads the
package, fails with *Dynamic require of "events" is not supported*, and disables
it. The build therefore prepends a `createRequire(import.meta.url)` banner to
the server bundle. Any module bundling a CommonJS dependency needs the same
thing — it is the one non-obvious part of the packaging contract.

Node 20 is also why the gateway's `zlib-stream` compression is not used: plain
JSON, the traffic is a handful of messages a day.

## Setup

A Discord bot cannot DM a user it shares no guild with. The standard
single-user pattern applies:

1. Create an application and bot at the Discord developer portal.
2. Create a **private guild containing only Adeline and the bot**. It exists
   purely to satisfy the mutual-guild rule; nothing is posted to it.
3. Invite the bot with `bot` + `applications.commands` scopes.
4. Put the token in the dashboard secrets store as `discord.botToken`.
5. Set the handle in module config.

The bot is in **no other server by default** and needs no permission beyond
sending messages. It can be invited elsewhere later; nothing in the module
assumes it is not.

The handle `@antidamage` is resolved to a snowflake on first connect — via the
mutual guild's member list — and cached in config as a read-only `userId`. The
handle is what is configured; the id is what is displayed.

## Config

| key | type | default | notes |
|---|---|---|---|
| `handle` | string | — | e.g. `antidamage` |
| `userId` | string, readOnly | — | resolved from `handle`, shown not edited |
| `guildId` | string | — | the private guild, optional once `userId` is cached |
| `queueIntervalMs` | number 5000–300000 | `30000` | outbound flush cadence |
| `maxQueueDepth` | number 10–1000 | `200` | |
| `inbound.enabled` | boolean | `true` | off means outbound only |
| `inbound.mode` | `hermes` \| `confirm` | `hermes` | who answers a DM (§ Hermes mode) |
| `inbound.proposalTtlMs` | number 30000–900000 | `120000` | `confirm` mode only |
| `inbound.maxOpenProposals` | number 1–10 | `3` | `confirm` mode only |
| `inbound.rateLimitPerMinute` | number 1–60 | `10` | both modes |
| `hermes.baseUrl` | string | — | the address the module reaches the WebUI on, e.g. `https://<host>:8443` |
| `hermes.workspace` | string | blank | where a Discord-started session works; blank uses the WebUI's own |
| `hermes.model` | string | blank | blank ⇒ the profile default (deepseek) |
| `hermes.chatTimeoutMs` | number 30000–3600000 | `600000` | how long one turn may take |
| `agent.agent` | `claude` \| `codex` \| `hermes` | `claude` | who handles a fresh DM (§ Fresh messages) |
| `agent.model` | string | `sonnet` | passed to the agent's CLI as-is; blank ⇒ the CLI's default |
| `agent.effort` | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| blank | `medium` | blank ⇒ the CLI's default |
| `agent.runnerUrl` | string | — | the agent runner, e.g. `https://<host>:8444`; needed for `claude` and `codex` |
| `agent.pollIntervalMs` | number 5000–120000 | `15000` | how often an open job is checked |
| `messages.<hookId>` | template | see below | empty ⇒ that hook stays silent |

The WebUI password is the `discord.hermesWebuiPassword` **secret**, not config:
it goes to the dashboard secrets store (`PUT …/config` `{"secrets": {...}}`), so
an exported module config cannot carry it. The runner's bearer key is the
`discord.agentRunnerKey` secret, on the same terms.

Per-reminder echo settings are **not** here — they live on the reminder
(§ Per-reminder echo).

## Outbound

### Hooks consumed

`reminder.due`, `reminder.completed`, `reminder.uncompleted`,
`entity.action.applied`, `zone.action.applied`, `thermostat.transition`.

All server-side. `thermostat.transition` in particular must fire with no browser
open — "heater turned off when the room reached 22 degrees" happens in the
authority tick, not in the UI.

### Default templates

| hook | template |
|---|---|
| `reminder.due` | `Reminder: {reminder}` |
| `reminder.completed` | `Done: {reminder}` |
| `reminder.uncompleted` | `Reopened: {reminder}` |
| `entity.action.applied` | `{entity} {state}` |
| `zone.action.applied` | `{zone}: {reason}` |
| `thermostat.transition` | `{entity} {state}{target, prefixed " to "}{reason, prefixed " — "}` |

Written in the Nova register: plain, factual, no filler. The examples Adeline
gave — "Air conditioner turned on to 22 degrees", "heater turned off when room
reached 22 degrees" — are what the `thermostat.transition` template produces
with a target and a reason present.

`entity.action.applied` defaults are deliberately terse because it is the
noisiest hook; anyone who wants more sets a longer template.

### The queue

- Events append to an in-memory queue and, debounced 1 s, to
  `data/modules/discord-bot/queue.json` so a restart mid-window loses nothing.
- A `setInterval` at `queueIntervalMs` (default **30 s**) flushes if the queue is
  non-empty. Empty means no message and no API call at all.
- A flush batches every queued line into **one** Discord message. Each line
  carries its own event's timestamp:

  ```
  `19:42:07`  Heater turned off — room reached 22°
  `19:42:31`  Done: put the bins out
  ```

  The timestamp is the event's `at`, never the send time. A line delivered
  29 seconds late still reads correctly. This is the point of the whole design.
- Over 2000 characters, the batch splits across messages at line boundaries.
- At `maxQueueDepth` the oldest lines are dropped and the flush prepends
  `(N earlier events dropped)`. Silently losing events is worse than saying so.
- A failed send re-queues the batch once, then drops it and records
  `lastError`. The queue never grows without bound because of a dead network.

### Once per occurrence

A reminder is announced **once**. The key is the occurrence — event id, task
id, and the event's own timestamp — so tomorrow's instance of a daily reminder
still announces, and a completion is tracked apart from its due notice.

The record is persisted (`echoed-reminders.json`, `src/echo-memory.ts`), which
is the whole point: the dashboard's own edge guard for `reminder.due` is
in-memory (`lib/dashboard-events.ts` → `store.taskAlertSessions`), so a
restart re-fires for every reminder still inside its alert window. Kept on
this side because this is the only layer that knows what was actually sent.
Remembered for 7 days, capped at 500 occurrences, pruned on write.

## Per-reminder echo

Injected into the reminder editor through `reminder.editor.fields`:

> **Echo to Discord**  ☐ On reminder  ☐ On completion

Two independent checkboxes. Stored on the task in the generic
`Task.moduleData` field added by the module system:

```json
{ "discord-bot": { "onDue": true, "onComplete": false } }
```

`reminder.due` and `reminder.completed` check that flag and skip the event
entirely when it is off — the template is not even rendered. `moduleData` is
also surfaced on `ModuleEvent.task.moduleData` so the check needs no second
read.

`reminder.uncompleted` follows `onComplete`, so an undo retracts visibly rather
than leaving a false "Done" as the last word.

## Status

`api.setStatus` publishes, and the `config.module.panel` slot renders:

| field | |
|---|---|
| `connected` | gateway state: connecting / online / resuming / offline |
| `username` | the bot's own `user#discriminator` |
| `resolvedUserId` | the snowflake behind `handle` |
| `latencyMs` | last heartbeat ACK round trip |
| `queueDepth` | lines waiting |
| `lastSendAt` | |
| `openProposals` | inbound proposals awaiting a button |
| `openVetoes`, `lastVetoAt`, `lastVetoError` | face-login vetoes |
| `lastError` | |
| `inboundMode` | the effective mode, `hermes` or `confirm` |
| `inboundModeWarning` | the configured value when it was neither, so a typo is visible |
| `linkedSessions` | reply → session links held |
| `lastHermesAt` | the last DM Hermes answered |
| `lastHermesError` | why the last Hermes turn or login failed, or `null` |

A broken bridge — an unreachable WebUI, a wrong password, a missing URL — reports
`state: "error"` with that reason as the summary whenever `inbound.mode` is
`hermes` and the bot itself is otherwise set up; a missing token or an unresolved
handle still reports `needs-setup` first.

## Agent attention pings

`POST /api/modules/discord-bot/attention`, authenticated by the
`discord.attentionKey` secret in an `x-nova-attention-key` header, DMs a single
line: `🔔 **Needs you** — <summary>` (summary trimmed to 400 characters).

It sends directly rather than joining the queue — the caller is an agent that
has already stopped and is waiting on a human, so a batching delay is the one
thing the message cannot afford. A bad key is `401`, a missing summary `400`,
and an unsendable DM `503` with the reason. Never a quiet `200`: the calling
agent has to know whether anyone was told.

The rule that obliges agents to call it is in `AGENTS.md`, "Ping Discord before
you stop for the owner".

---

## Inbound commands

### Interpretation (confirm mode)

The subsections from here to *Interaction handling* describe `confirm` mode
only; the default is `hermes`, in *Hermes mode* below.

Inbound messages are **not** interpreted by a second LLM inside the module.
They go to the existing voice agent, which already turns natural language into
dashboard actions and already has the LLM, the MCP tool surface, conversation
context, and the verification loop.

`POST /v1/utterances` on the voice host (`nova-voice/src/nova_voice/api.py:1102`)
takes an `Utterance` and returns a `HandleResult`. `Utterance.text(...)`
(`domain.py:104`) is the text constructor. Handling an utterance does **not**
speak — TTS is driven by the audio runtime from `response_text`, and
`satellite_id="dashboard-preview"` is an existing non-speaking text caller
(`service.py:878`). Discord uses `satellite_id="discord"`, `room_id="discord"`.
No change to `nova-voice` is required.

### Filtering

Before anything reaches the LLM:

- DMs are read **only** from the configured `userId`. Every other DM is dropped.
- Guild messages are ignored unless the bot is explicitly `@`-mentioned.
- Messages from bots, including itself, are dropped.
- Rate limited per `inbound.rateLimitPerMinute`; every message over the limit
  gets the same "slow down" reply until the window rolls.

### Hermes mode

`inbound.mode` decides what a DM does. `hermes` (the default) answers it with
Hermes; `confirm` is the dry-run house-command path described from here on. An
unrecognised value uses `confirm` — a typo must never silently choose the path
with no gate in front of it — and the value is reported in the module status.

In `hermes` mode the text goes to the **Hermes WebUI** on Ununhexium, reached
over the tailnet (`hermes.baseUrl`; the WebUI binds loopback and is published by
`tailscale serve`). Two calls:

| call | purpose |
|---|---|
| `POST /api/session/new` `{workspace, worktree:false}` | a session, returned as `session.session_id` |
| `POST /api/chat` `{session_id, message}` | one turn; `answer` is what she is told |

The module answers with `answer`, posted as a **Discord reply** to her message.
A turn runs under Hermes' own approval policy; the module adds no gate of its
own, which is what `confirm` is for.

**Which session.** Every message the bot sends is recorded against the Hermes
session that produced it. A DM that is a Discord reply to one of those messages
continues that session; anything else starts a new one.

Two ways a link can be lost, and they do not behave the same way:

| case | behaviour |
|---|---|
| the session was deleted in the WebUI, and the module still holds the link | a new session, **and the DM says so** |
| the link is past its TTL (7 days) or was evicted by the cap | a new session, silently — Discord tells the module nothing about a message it no longer remembers |

Before continuing a linked session the module asks the WebUI whether it still
exists (`GET /api/session`). It is checked for rather than inferred because a
turn in a session whose sidecar is gone answers `500` from the sync chat handler,
not `404` — indistinguishable from any other internal error, and forking a
conversation on a server error would be worse than the extra round trip.

**The map.** Message id → session id, in module storage
(`hermes-links.json`), bounded by 7 days and 200 links, oldest evicted first. It
is persisted because the case it exists for — replying to yesterday's message —
outlives a dashboard restart.

**Answers longer than one message** are split at line boundaries into
<= 1900-character messages, joined with newlines (a single line longer than that
is cut at the limit — nothing is truncated); each part is a reply to her
message and each part is recorded against the same session, so replying to the
last part of a long answer works like replying to a short one. A code fence
spanning a split is not repaired — a DM, not a document.

**Credentials.** The password is the `discord.hermesWebuiPassword` secret. The
client logs in at module start (so a bad credential is visible on the card
rather than on the first DM), keeps the `hermes_session` cookie, and re-logs in
once on a `401`. An unreachable WebUI, a wrong password, or any non-2xx from the
WebUI is reported in the DM *and* in the module status — never silence.

**A config save takes effect without a reload.** The client is rebuilt whenever
module config changes, so a changed URL, password or timeout applies from the
next DM. Building it is deliberately not awaited at startup: a WebUI that is slow
or down must not hold the bot offline, and that state shows on the card instead.

**Two failures, told apart.** Hermes failing to answer reports `Hermes could not
answer: …`. Discord refusing a message the module is sending reports `Hermes
answered, but Discord would not take the message: …`. Each message that lands is
recorded against its session as it lands, so a partly delivered answer still
points back at the session it came from.

**Status.** `inboundMode`, `inboundModeWarning`, `linkedSessions`, `lastHermesAt`
and `lastHermesError` join the module's status detail, and a broken bridge
reports `state: "error"` on the module rather than `ok` with a footnote.

### Fresh messages: a headless agent session

Added 2026-10-18. In `hermes` mode, a DM that is **not a Discord reply** is a
fresh request. `agent.agent` decides who handles it:

| `agent.agent` | a fresh DM |
|---|---|
| `claude` (default) | a new headless Claude Code session on Ununhexium, `agent.model` / `agent.effort` (default `sonnet` / `medium`) |
| `codex` | a new headless Codex session on Ununhexium, same two settings |
| `hermes` | a new Hermes WebUI session, exactly as in § Hermes mode |

An unrecognised `agent.effort` is reported in `agentWarning` and the CLI's
default is used. An unrecognised agent runs nothing: the DM is answered with the value that was
not understood, and the status names it (`agentWarning`). A typo must not
quietly pick an agent.

**Replies are unchanged.** A DM that replies to a message the bot sent continues
the session that sent it, as in § Hermes mode. The link now records which agent
owns the session, so a reply to a Claude Code answer resumes that Claude Code
session (`claude -p --resume`), a reply to a Codex answer resumes that Codex
session, and a reply to a Hermes answer — or to a message with no link, such as
an attention ping — takes the Hermes path exactly as before. A link with no
agent recorded (every link written before this change) is a Hermes link.
`agent.model` and `agent.effort` belong to the configured agent: a reply that
resumes a different agent's session (the setting changed since) is sent with
neither, so that CLI uses its own defaults — `sonnet` means nothing to Codex.

**Only her messages.** The § Filtering rules apply unchanged: only the
configured `userId` (resolved from the handle `antidamage`) is read, and every
other author is dropped before anything is sent anywhere.

**The brief.** The DM text is the prompt. The module adds a fixed brief, sent as
an appended system prompt for Claude Code and prepended to the prompt for
Codex. Its wording is `src/agent-brief.ts`, and it says:

1. **No interaction.** The session is unattended: nobody answers a question,
   approves a prompt or watches it. Do not ask, wait, or send an attention ping.
   Resolve open questions from the repositories, MemPalace, the environment and
   sensible defaults, and name any judgement call in the reply.
2. **Complete the task.** Fire-and-forget, but not optional. If part of it
   genuinely cannot be done, finish the rest and state exactly what is left and
   why.
3. **Classify first.** *Site change* — a change to the code or content of an
   existing site, app or other repository-backed product: follow that
   repository's change process from AGENTS.md (branch, pull request, independent
   review, merge). *Action* — a task on a PC, the network, a device, a service
   or an account. *Information* — a question. Only a site change gets a pull
   request; an action or a question is done directly, as quickly as possible.
4. **Reply briefly.** The final message is the Discord reply, read on a phone:
   outcome first, then what was verified, then anything left. No narration.

**It is asynchronous.** A site change can take an hour, far past any HTTP wait,
so the module does not hold a request open:

1. The module `POST`s the job to the runner, which answers `202` with a job id
   at once. The module reacts 👀 to her message: picked up, nothing more.
2. The job is recorded in module storage (`agent-jobs.json`: job id, channel,
   her message id, agent, start time), so a dashboard restart keeps waiting for
   it.
3. Every `agent.pollIntervalMs` the module asks the runner for each open job.
4. When one finishes, its answer is posted as replies to her message, split as
   in § Hermes mode, and each message sent is linked to `{agent, sessionId}`.
5. A failed job is reported as a reply (`The claude session failed: …`). If it
   got as far as a session id, that message is linked too, so replying resumes
   the session that failed.
6. A job the runner no longer knows (`404`) is reported and dropped. An
   unreachable runner is retried on the next poll; a job older than 6 hours is
   then reported as lost and dropped, never polled forever.

A submission that fails — no runner URL, no key, the runner refused or
unreachable — is answered in the DM with the reason. Never silence.

**Status.** `agent`, `agentWarning`, `pendingAgentJobs`, `lastAgentAt` and
`lastAgentError` join the status detail. A failing runner reports
`state: "error"`, like a broken Hermes bridge.

### The agent runner

`runner/agent-runner.mjs` in this repository: a dependency-free Node HTTP
service on Ununhexium that starts the CLI sessions. The module runs on the Nova
host and cannot start a process on Ununhexium; the runner is the one place that
does.

| route | |
|---|---|
| `GET /health` | `{ok, running, queued}` — no key needed; counts only, no job contents |
| `POST /jobs` `{agent, prompt, brief?, model?, effort?, resumeSessionId?}` | `202 {jobId}`; `400` for an unknown agent or effort, an empty prompt, a model not matching `^[A-Za-z0-9._:\[\]-]{1,80}$`, a resume id not matching `^[A-Za-z0-9-]{8,80}$`, or a body that is not JSON or is over 256 KB |
| `GET /jobs/<id>` | `{jobId, agent, state: queued\|running\|done\|failed, sessionId, answer, error, createdAt, startedAt, finishedAt}`; `404` unknown |

- **Auth.** Every route but `/health` needs `Authorization: Bearer <key>`;
  anything else is `401`. The key is compared in constant time.
- **Config** is a JSON file outside every repository (`--config`, default
  `%LOCALAPPDATA%\nova-agent-runner\config.json`): `key`, `port` (default
  `8791`), `bind` (default `127.0.0.1`), `workspace` (the directory sessions
  start in), `maxConcurrent` (default `2`), `timeoutMs` (default 4 h),
  `claudePath`, `codexPath`, `claudePermissionMode` (default `auto`). It
  refuses to start with a key shorter than 32 characters, and logs to
  `runner.log` beside the config.
- **Reach.** It binds loopback and is published to the tailnet by
  `tailscale serve` on `8444` (HTTPS, tailnet only), like the Hermes WebUI on
  `8443`.
- **Claude Code**: `claude -p --output-format json --permission-mode <mode>
  [--append-system-prompt-file <file>] [--model <m>] [--effort <e>]
  [--resume <id>]`, prompt on stdin. The brief is written to
  `jobs/<id>.brief.txt` and passed only when one was sent; model and effort
  only when set. `result` is the answer, `session_id` the session, `is_error`
  a failure.
- **Codex**: `codex exec [resume <id>] --json
  --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -o <file>
  [-m <m>] [-c model_reasoning_effort="<e>"] -`, brief and prompt on stdin;
  model and effort only when set. The session id is `thread_id` from the
  `thread.started` event; the answer is the `-o` file.
- **Headless.** Every child is spawned with `windowsHide`. The runner itself is
  started at logon by the scheduled task `Nova-AgentRunner` as
  `conhost.exe --headless node.exe …`, so no window ever reaches her desktop.
- **Bounds.** At most `maxConcurrent` sessions run; more wait in order. A
  session past `timeoutMs` is killed with its whole process tree and fails as
  timed out.
- **Persistence.** Each job is a JSON file in the runner's data directory;
  files older than 7 days are pruned when the runner starts. A job that was running when the runner stopped is marked failed
  (`the runner restarted while this job ran`) at the next start; a queued one is
  started.
- `runner/install-runner.ps1` registers the scheduled task, writes a config with
  a fresh key if there is none, and prints only where the config is — never the
  key.

### Relay (confirm mode)

Used when `inbound.mode` is `confirm` — the behaviour in everything from here to
the end of this section.

The module's own route `POST /api/modules/discord-bot/inbound`
(`module-system.md` §8) forwards to the voice host. The relay lives on the
dashboard, not in the module's Discord process, so the voice-host URL and mTLS
identity stay where they already are (`lib/voice-host-settings/endpoints.ts` and `store.ts`) rather
than being duplicated into module config.

**Every inbound utterance is sent with `dry_run: true`.**

### The confirmation gate

`Utterance.dry_run` (`domain.py:100`) plans and authorizes the turn for real —
alias resolution, argument validation, request-body construction — and withholds
only the final household mutation, returning each withheld call verbatim in
`HandleResult.dry_run_requests` as `{ method, path, body }`
(`nova_voice/dry_run.py:29`). The interception point is the dashboard client, so
a dry-run turn provably cannot touch the house.

That gives an exact, non-heuristic answer to "would this have changed
anything?":

| `dry_run_requests` | behaviour |
|---|---|
| empty | Nothing would have changed. It was a question or chat. Reply with `response_text` immediately, no buttons. |
| non-empty | Reply with a summary and **Confirm / Cancel** buttons. Nothing runs yet. |

A read-only query ("is the heater on?") answers straight away. Ordinary chat
("thanks nova") answers conversationally, or not at all if `response_text` is
empty. Neither can produce an action, because neither produces a withheld
request — this is a property of what the agent actually planned, not of a
confidence score or a keyword match.

### Confirming

On **Confirm**, the module replays the held `dry_run_requests` against the
dashboard API verbatim, in order. It does **not** re-send the utterance with
`dry_run: false` — that would re-interpret, and the second reading could differ
from the one shown. Replaying the exact bodies means what runs is precisely what
was displayed.

- Proposals are held server-side, keyed by interaction custom id, with a TTL
  (`inbound.proposalTtlMs`, default 120 s). On expiry the proposal is discarded
  and the message edited to say so.
- At most `inbound.maxOpenProposals` outstanding; a new command over the cap
  refuses rather than queueing.
- **Cancel** discards immediately.
- The original message is edited after every outcome — confirmed with results,
  cancelled, or expired — so the DM history is the audit trail.
- Executed actions are echoed back through the normal outbound queue, so
  everything the house did is one stream regardless of what triggered it.
- Every proposal, confirmation, cancellation and expiry is logged via
  `api.log`.

### Interaction handling

`INTERACTION_CREATE` over the gateway; acknowledge within 3 s with a deferred
update, then edit. A stale button (proposal gone) edits the message to say the
proposal expired rather than failing silently.

---

## Done means

With `inbound.mode: confirm` (the default is `hermes`; its own list follows):

- The bot shows **Online** in Discord and the config panel reports the same.
- Ticking "On completion" on a reminder and completing it produces a DM within
  30 s whose timestamp is the completion time, not the send time.
- Turning the aircon on produces the configured message.
- "is the heater on?" answers immediately with no buttons.
- "turn the aircon on at 22" asks to confirm, changes nothing until the button
  is pressed, and on Confirm does exactly what it said.
- "thanks nova" produces no proposal and no action.
- A DM from anyone else produces nothing.
- Restarting the dashboard mid-window loses no queued lines.
- The public repo contains no token, id, or household detail.

### Done means — Hermes mode (the default)

- A DM is answered by Hermes within the WebUI's own turn time, and the answer
  arrives as a **reply** to the message she sent.
- Replying to that answer continues the same session: the session id in the
  WebUI sidebar does not change between the two turns.
- A DM that is not a reply creates a **new** session, visible in the WebUI
  sidebar and in Hermex.
- Restarting the dashboard does not lose reply → session links, so a reply to
  yesterday's answer still lands in its session.
- An answer longer than 1900 characters arrives as several messages, all replies
  to her message, none truncated, all in the same session.
- With the WebUI stopped, a DM produces a stated failure in Discord (`Hermes
  could not answer: …`) and the module reports `state: "error"` — never silence.
- `inbound.mode: confirm` restores the dry-run + Confirm/Cancel behaviour above,
  unchanged.

### Done means — fresh messages

- A fresh DM gets 👀 within seconds, and later the agent's answer as a reply to
  it; with defaults, the session is Claude Code on `sonnet` at `medium` effort.
- Replying to that answer resumes the same Claude Code session.
- Replying to a Hermes answer still continues its Hermes session.
- `agent.agent: hermes` makes a fresh DM behave exactly as before this change.
- A DM from any account other than the configured handle starts nothing.
- With the runner stopped, a fresh DM is answered with the reason, and the
  module reports `state: "error"`.
- No console window appears on Ununhexium when a session starts.
