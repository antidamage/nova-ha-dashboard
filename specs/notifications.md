<!-- START HERE, never here alone: read C:\workspace\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Notifications

One-off messages that an agent or script can put on every dashboard screen. They
are not reminders or tasks: no schedule, no repeat, no completion, no chime, and
they never appear in the Reminders panel or the sigil bar.

## Behaviour

- `POST /api/notifications` creates one and pushes it to every connected screen
  over the shared `/api/events` stream (`notification` event). A screen that
  connects later receives the active list (`notifications` event).
- Each screen shows active notifications as a stack of the reminder alert's
  banner (`NotificationStack`, mounted in `Dashboard.tsx` and the Plain design's
  `Root.tsx`), drawn with that banner's own classes (`task-alert-banner`,
  `task-alert-title` in `app/styles/tasks/task-alerts.css`) in a compact form:
  title large, `body` and a small `severity · source` line below. It is not an
  overlay and not gated by the per-device Reminder Banners setting: a
  notification shows on every screen. The stack sits at the top centre, above a
  reminder's overlay (z-index 1510 over 1500), ignores pointer events itself
  and scrolls if it overflows. `.task-alert-stack` is excluded from the
  `.dashboard-shell > *` lift in `app/styles/dashboard/background.css`, which
  would otherwise force it to `position: relative`.
- Tapping a banner dismisses it for every screen (`DELETE /api/notifications?id=`,
  then a `notification-dismiss` event). When two or more are showing, a
  "Clear all (N)" button above the stack dismisses every notification that
  screen is showing, one `DELETE ?id=` each (not `?all=1`, so one that arrived
  after the screen last rendered is not cleared unseen). A 404 from one that
  already expired is ignored. No screen calls `?all=1`; it stays for scripts.
  Every tappable element carries `task-alert-banner`, because the reminder
  alert's capture-phase tap swallow (`useTaskAlerts`) only lets taps on that
  class through.
- A notification expires after `ttlSeconds` (default 3600, range 1 to 604800), or
  stays until dismissed when `sticky` is true. The server drops expired entries
  on every read and write; screens also hide them locally by `expiresAt`.
- At most 50 are kept; the oldest is evicted (and a dismiss event sent) when a
  new one would exceed that.
- Plain markup only, no animation, canvas or filters, so rich and lite
  experience modes behave identically (`experience-modes.md` parity rule).

## API

| Request | Result |
|---|---|
| `GET /api/notifications` | `{ notifications: DashboardNotification[] }`, oldest first |
| `GET /api/notifications?command=docs` | self-describing JSON |
| `POST /api/notifications` | `201 { notification }`; `400 { error, docs }` on bad input |
| `DELETE /api/notifications?id=<id>` | `{ ok: true }`; `404` if unknown |
| `DELETE /api/notifications?all=1` | `{ ok: true, dismissed: string[] }` |

Create body:

| Field | Rule |
|---|---|
| `title` | required, trimmed, up to 120 characters |
| `body` | optional, up to 500 characters |
| `severity` | `info` (default), `success`, `warning`, `critical`; shown as a word in the small line under the title unless `info`, and `critical` uses `role="alert"` |
| `source` | optional, up to 40 characters, shown small under the message |
| `ttlSeconds` | optional number 1 to 604800, default 3600 |
| `sticky` | optional; `true` means no expiry and `ttlSeconds` is ignored |

Like the other dashboard command APIs it carries no authentication; it is
reachable from the LAN only.

## Persistence

`data/dashboard-notifications.json` (override: `NOVA_DASHBOARD_NOTIFICATIONS`),
rewritten atomically through a write queue, so a restart keeps unexpired
notifications.

## Code

`lib/notifications/` (`model.ts` validation and expiry, `store.ts` file and
publishing, `types.ts`), facade `lib/notifications.ts`, route
`app/api/notifications/route.ts`, SSE helpers in `lib/dashboard-events/publish.ts`
and `lib/dashboard-events/notifications.ts`, UI in `app/components/notifications/`.
Tests: `lib/notifications/notifications.test.ts`. Agent skill: `skills/nova-notifications/SKILL.md`.
