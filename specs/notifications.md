<!-- START HERE, never here alone: read C:\workspace\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Notifications: retired

Retired 2026-11-22, card 339099 (after card 854887 removed the demo's staged ones).
alex: *"\"notifications\" are only ever alerts pushed through the status orb
using only what it has now, no additional features"*, and of the live stack,
*"I thought you were getting rid of the feature."*

**What this means for the dashboard:**

- **No pop-up stack.** The top-centre notification stack (`NotificationStack`)
  is gone. `/api/notifications` is gone too, along with its store, its
  `notification` / `notification-dismiss` / `notifications` SSE events and the
  `nova-notifications` agent skill. A `POST` to it is a 404.
- **The orb carries alerts with what it already has.** Its existing entries
  each alert when their own condition holds: a finished timer, a finished wash,
  a due reminder, or any entry past its configured alert threshold, such as
  `host-gpu`. See `status-orb-stack.md`. A notification never becomes a new orb
  entry kind, and no feature is added to the orb to carry one.
- **Messages for a person** go through the Discord attention route
  (`nova-module-discord`), not the dashboard.
- **Do not bring it back** as a parity gap, a nightly improvement or a
  convenience for scripts. That decision is hers.

The stored `data/dashboard-notifications.json` on the host is no longer read
and is left where it is.

The two GPU guards (`nova-gpu-guard-windows`, `nova-monitoring/gpu-guard`)
stopped posting dashboard notices in the same change. They keep Discord
attention, and the Windows guard keeps its tray toast. Reminders, their
banner (per-device, off by default) and the bottom-right `toast` string in
`Dashboard.tsx` are separate features and are unchanged.

Git history before card 339099 holds the retired design, for reference only.
