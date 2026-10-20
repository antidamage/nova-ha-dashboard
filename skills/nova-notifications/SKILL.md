---
name: nova-notifications
description: "Put a one-off notification on every Nova dashboard screen through POST /api/notifications, and list or dismiss them. Use when an agent should tell the household something that is not a reminder or task: a long job finished, a deploy failed, something needs looking at. Live data, not source code: no build, commit or deploy."
---
<!-- START HERE, never here alone: read D:\Projects\Agent\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->

# Nova notifications

A notification is a one-off message shown top-right on every dashboard screen
(wall kiosk, tablets, phones) until someone taps its X or it expires. It is not
a reminder or task: no schedule, no repeat, no chime, and it never appears in
the Reminders panel. For anything that should happen at a time or repeat, use
`nova-reminders`. To reach the owner's phone when you must stop and wait, use the
`discord-notify` skill.

It is live data in the running dashboard. Do not edit source, build or deploy.

## Endpoint

```text
<dashboard-origin>/api/notifications
```

`<dashboard-origin>` is the live dashboard's address, the same one the
`nova-reminders` skill uses. Set `$base` to it in the examples below.

`GET /api/notifications?command=docs` returns the current field list; read it
first if anything below looks stale.

## Fields

| Field | Rule |
| --- | --- |
| `title` | Required, up to 120 characters. Shown in capitals. |
| `body` | Optional, up to 500 characters. |
| `severity` | `info` (default), `success`, `warning`, `critical`. Sets the border colour; use `critical` only when something needs attention now. |
| `source` | Optional, up to 40 characters. Put your agent name here, e.g. `claude-code`. |
| `ttlSeconds` | Optional, 1 to 604800, default 3600. |
| `sticky` | Optional. `true` keeps it until dismissed and ignores `ttlSeconds`. Use sparingly: a sticky note stays on the wall. |

## Create

```powershell
$body = @{
  title    = 'Dashboard update merged'
  body     = 'nova-ha-dashboard PR 12 is on main.'
  severity = 'success'
  source   = 'claude-code'
  ttlSeconds = 1800
} | ConvertTo-Json
Invoke-RestMethod -Uri "$base/api/notifications" -Method POST `
  -ContentType 'application/json' -Body $body -TimeoutSec 15
```

A `201` returns `{ notification }` including its `id`. A `400` returns the
reason in `error` and the docs. Keep a returned `id` if you may need to dismiss
it.

## List

```powershell
(Invoke-RestMethod -Uri "$base/api/notifications" -TimeoutSec 10).notifications |
  Format-Table id, severity, title, expiresAt -AutoSize
```

## Dismiss

```powershell
Invoke-RestMethod -Uri "$base/api/notifications?id=<id>" -Method DELETE -TimeoutSec 10
```

`?all=1` dismisses every active notification. Only use it when asked: it also
removes notifications other agents raised.

## Conventions

- The wall display is visible to visitors. Keep titles and bodies free of
  medical, financial and other personal detail, the same as reminder titles.
- Say what happened and what, if anything, someone must do. One notification
  per event; do not post progress updates, and do not repeat one that is still
  active.
- Use the shortest `ttlSeconds` that still lets someone see it. Default
  `info`/`success` is fine for an hour; reserve `sticky` for things that stay
  true until a person acts.
- If the dashboard is unreachable (it does not answer), say so in
  your reply. Do not retry in a loop.

## Verify

After creating, `GET` the list and confirm the entry is there with the
expiry you intended. The screens update over the live event stream, so no
reload is needed. Then stop: there is nothing to build or deploy.
