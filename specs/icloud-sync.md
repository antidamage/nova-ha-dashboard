# iCloud Sync

`lib/icloud-config.ts` reads iCloud sync configuration from dashboard config
and environment variables.

iCloud sync is enabled only when both `ICLOUD_USERNAME` and
`ICLOUD_APP_PASSWORD` are set.

Sync behavior:

- Uses CalDAV at `https://caldav.icloud.com` by default.
- Uses Basic auth through `tsdav`.
- Discovers calendars/reminder lists.
- Filters by configured calendar/reminder allowlists when present.
- A calendar or reminder allowlist containing `none` or `__none__` disables
  that source entirely.
- Sync window starts at now and extends by configured sync days.
- Default sync window is 7 days.
- Default background sync interval is 5 minutes.
- Auth failures set a backoff and emit a dashboard error.

VEVENT mapping:

- Timed calendar events become read-only tasks.
- All-day events are skipped.
- Recurrence is expanded with a safety cap.
- Recurrence exception components are ignored by current code.
- Each occurrence receives a deterministic ID.

VTODO mapping:

- Reminder lists are queried with an explicit `VTODO` CalDAV filter.
- Completed reminders are skipped.
- Date-only reminders are scheduled at the configured local default reminder
  hour. No-due reminders are skipped because the dashboard has no unscheduled
  task bucket.
- Timed due dates become read-only tasks.
- If both DTSTART and DUE are available, DTSTART is start and DUE is end.
- If only DUE is available, DUE is start and default duration is used.
- Simple daily, weekly, monthly, and yearly recurring VTODO due dates are
  advanced into the current sync window.
- Apple's CalDAV placeholder reminders for upgraded/shared lists are ignored.

Diff behavior:

- Local tasks are preserved.
- Local tasks that match an iCloud Reminder by normalized name and current
  local occurrence date are linked by removing the local duplicate so the iOS
  reminder takes precedence. Repeating local tasks are linked when their
  normalized name matches an iCloud Reminder occurrence.
- Mirrored tasks are added, updated, or removed to match iCloud.
- Unchanged mirrored tasks preserve dismissed and alert-dismissed fields.
- Sync status records last sync time, calendars, reminders, errors, and backoff
  state.
