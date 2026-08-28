# Discord bot module

Produced by plan `there-are-two-major-dazzling-corbato`
(`~/.claude/plans/there-are-two-major-dazzling-corbato.md`), 2026-08-28.

Depends on [`module-system.md`](./module-system.md) — this is the first real
consumer of that hook API, and the thing that proves it is sufficient rather
than theoretical.

## Why

Two jobs:

1. **Outbound.** Echo household reminders and control events to Adeline's
   Discord DMs, so what the house did is legible away from the dashboard.
2. **Inbound.** Let a DM be interpreted as a dashboard command, without a chatty
   message ever becoming an action by accident.

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
  templates.ts
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
- Bundles `ws` — the container is `node:20-trixie-slim` and has no stable global
  `WebSocket`.

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
| `secretName` | string, `format: secret` | `discord.botToken` | |
| `queueIntervalMs` | number 5000–300000 | `30000` | outbound flush cadence |
| `maxQueueDepth` | number 10–1000 | `200` | |
| `inbound.enabled` | boolean | `true` | |
| `inbound.proposalTtlMs` | number 30000–900000 | `120000` | |
| `inbound.maxOpenProposals` | number 1–10 | `3` | |
| `inbound.rateLimitPerMinute` | number 1–60 | `10` | |
| `messages.<hookId>` | template | see below | empty ⇒ that hook stays silent |

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
| `lastError` | |

---

## Inbound commands

### Interpretation

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
- Rate limited per `inbound.rateLimitPerMinute`; over the limit gets one
  "slow down" reply and then silence until the window rolls.

### Relay

The module's own route `POST /api/modules/discord-bot/inbound`
(`module-system.md` §8) forwards to the voice host. The relay lives on the
dashboard, not in the module's Discord process, so the voice-host URL and mTLS
identity stay where they already are (`lib/voice-host-settings.ts:118`) rather
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
