# System power controls and the reconnect blocker

The configuration page ends with a **System Power** section
(`SystemControlConfig`, rendered last in `ConfigWorkspace`) holding the two most
destructive actions in the UI, which is why they sit at the very bottom:

- **Restart Nova Services** — restart Home Assistant and the rest of Nova's
  service containers (MQTT, Matter, voice, bridges), then the dashboard itself —
  a "restart everything short of a reboot". The host computer stays on.
- **Reboot Nova** — reboot the whole host machine.

### Visual style

- Both buttons are rectangular "construction boxes": black filled with a
  highlight-colour tint, outlined in the highlight colour, with diagonal hazard
  hatching banded across the top and bottom edges. All colours derive from the
  live `--cyber-highlight` theme token, so the section follows the active theme.
- The styles are global (not scoped to `.dashboard-shell`), and the stripe
  decorations are child `<span>`s rather than pseudo-elements, so they survive
  the dashboard-shell's `.momentary-feedback` press-flash `::after` and its
  forced `position`/hover rules.

### Double confirmation

- Each action requires two confirmations. The first press opens a dialog
  ("Confirmation 1 of 2"); confirming opens a second ("Confirmation 2 of 2 —
  last chance"); confirming that fires the request. Both dialogs state plainly
  that the system will be unavailable.
- Dialogs render through a portal to `document.body` so they escape the
  `.zone-panel` `clip-path`, which otherwise establishes a containing block for
  `position: fixed` and clips the overlay to the panel. Tapping anywhere outside
  the box, or pressing Escape, dismisses it; it cannot be dismissed while a
  request is in flight.

### Restart Nova Services mechanism

- `POST /api/system/restart-stack` writes a `restart-stack` request into
  `data/system/control/` via `lib/system-control.ts`. It deliberately does **not**
  self-exit: bouncing Home Assistant and the other host containers needs
  `docker restart`, which only the host helper can do. The per-minute
  `ops/nova-system` cron drains the request and, in start-up dependency order,
  `docker restart`s each service container in `NOVA_STACK_CONTAINERS` (default
  `mosquitto matter-server homeassistant tuya-mobile-mqtt-bridge
  linux-voice-assistant`), then `docker stop`s the dashboard container last so
  the systemd unit's `Restart=always` relaunches a fresh one. Missing containers
  are skipped; a failure on any one is recorded but does not abort the rest. No
  host privilege is needed (the app owner is in the `docker` group).
- Because it goes through the cron channel, there is up to ~60 s of lag before the
  restart begins; the reconnect blocker covers the whole window.

- A lower-level `POST /api/system/restart-dashboard` still exists (production:
  flush then `process.exit(0)` ~300 ms later for a ~8 s self-relaunch; dev: file
  channel) and the `restart-dashboard` host action remains, but the System Power
  button now uses `restart-stack`.

### Reboot Nova mechanism

- `POST /api/system/reboot` writes a `reboot-host` request into
  `data/system/control/` via `lib/system-control.ts`, mirroring the
  self-updater's file channel. The host helper `ops/nova-system` (per-minute
  cron) drains it and runs `systemctl reboot`, gated by the NOPASSWD sudoers rule
  in §27. The containerised app never reboots the host directly.

### Reconnect blocker (every screen)

- After a confirmed restart or reboot, the dashboard shows an un-dismissable
  full-screen blocker: a 25%-black wash with a highlight-scheme spinner card in
  the same construction-box style (shared `SystemBlocker`, portaled to body).
- The initiating device (`SystemControlConfig`) shows it immediately, waits 5 s,
  then polls `/api/version` and navigates to `/` once Nova is reachable again. A
  reboot first waits to *see* Nova go offline (it keeps answering for a moment)
  before treating "reachable" as "back"; a 6-minute ceiling prevents a permanent
  trap.
- A global `SystemActivityBlocker`, mounted in `app/layout.tsx`, runs on **every**
  screen. It polls `/api/update` (which doubles as a reachability probe) and
  shows the same blocker whenever Nova is unreachable (restart/reboot) **or** an
  update is building or switching — automatic or manual — then reloads to the
  fresh build once Nova returns idle. So all displays block during a restart,
  reboot, or update, not just the device that triggered it.
- Robustness: entering the blocker from a clear state needs two consecutive
  failed polls (to ride out network blips); once blocking, a single miss keeps it
  up (the real restart window). A `phaseAt` staleness guard ignores a wedged
  "busy" update phase so a dead updater cannot trap every screen forever. A
  shared module flag (`systemBlockerState`) suppresses the global blocker on the
  initiating device so it never stacks two overlays. The blocker is disabled in
  demo mode.

### Host control channel and helper

- `data/system/control/<id>.json` carries `{ action: "restart-dashboard" |
  "restart-stack" | "reboot-host" }` from app to host; `data/system/state.json`
  records the last host action and result (for `restart-stack`, which services
  restarted / were skipped / failed) for observability.
- `ops/nova-system {process|restart-dashboard|restart-stack|reboot|status}`
  drains and acts;
  `ops/install-nova-system.sh` installs the binary, the per-minute cron, and —
  with `--install-sudoers` — the reboot sudoers rule.
