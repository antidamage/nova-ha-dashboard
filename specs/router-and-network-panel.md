# Router and Network Panel

The network panel is rendered for the configured network zone.

Behavior:

- Polls `/api/router` every 333 ms.
- Refreshes on focus, visibility, online, and pageshow events.
- Keeps the last known good router metrics during transient misses.
- Shows download gauge, download/upload bars, WAN status, and live/offline
  state.

Server behavior:

- `/api/router` returns router-only dashboard state.
- It uses no-store cache headers.
