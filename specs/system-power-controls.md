<!-- START HERE, never here alone: read C:\workspace\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
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

### Network zone Computers panel: sleep, wake and shut down

This section is the spec for the Network zone's **Computers** panel
(`app/components/dashboard/DesktopSleepPanel.tsx`), not the `/config` page. It
gives each managed computer up to three construction-box buttons, in this
order: **Sleep** (Moon icon), **Wake** (Power icon), **Shut down** (PowerOff
icon). Each appears only when the computer is enabled and its capability is on
(`sleep`; `wake` plus a MAC address; `shutdown`). Nova itself is never one of
them. The Shut down box takes the danger treatment: outline, tint and hatching
in `--cyber-danger` (design extract `variables.css`) instead of the highlight
colour, so it cannot be mistaken for its neighbours.

- **Sleep**: `POST /api/desktop/sleep`, SSH `SetSuspendState(false, …)` on
  Windows. Terminal and fire-and-forget: the computer is marked sleeping so no
  later SSH (wallpaper sync) wakes it. One plain confirmation.
- **Wake**: `POST /api/desktop/wake`, a Wake-on-LAN magic packet. One plain
  confirmation.
- **Shut down**: `POST /api/desktop/shutdown`, SSH `shutdown.exe /s /f /t 0` on
  Windows. That is a **full** power-off, never Fast Startup's hybrid shutdown
  (that needs `/hybrid`, which is not passed) and never a restart. `/f` is
  deliberate: without it, one app holding unsaved work blocks a remote shutdown
  indefinitely behind a dialog nobody at the panel can see. Other platforms
  refuse it. Like sleep, it is terminal and fire-and-forget: the request
  resolves once the command is on the wire, a dropped session is success, only
  a failed connect is an error, and the computer is marked sleeping so nothing
  SSHes to it afterwards. Wake (WoL from S5) brings it back where the NIC and
  firmware allow. Everything the computer hosts stops with it (on the owner's
  workstation, Docker and the services in it) until it is started and signed
  in again.
- While a shutdown request is in flight the box is disabled (the same as Sleep's
  busy state); then the panel shows one status line for 6 s: "Shutdown sent to
  <name>" or the error.
- The `shutdown` capability is a toggle on the computer's card in `/config`
  (default off; a record without it reads as off).

**Shut down confirmation: two timed stages.** Shut down uses the shared
`ConfirmDialog` with two stages and per-stage timing:

| | Stage 1 | Stage 2 (last chance) |
|---|---|---|
| Confirm button locked after the stage opens | 3 s, counting down | 3 s, counting down |
| Then live for | 5 s, counting down | 5 s, counting down |
| Not confirmed in time | "Timed out. Nothing was sent." for 2 s, then closes | same |

The 5 s expiry is the owner's explicit safety requirement, and it applies only
to dialogs that set `expireMs`.

Stage 1 carries the whole warning: the computer fully powers off, open apps
close without saving, everything it hosts stops until it is started again, and
Wake may not bring it back (Wake-on-LAN from full power-off depends on its
firmware), so its power button may be needed. Stage 2 is one line: last chance.

- **Locking** uses `aria-disabled`, not `disabled`: focus stays on the button
  inside the dialog's focus trap and a click is ignored. `disabled` remains the
  busy state only.
- **The confirm label never changes** ("Shut down Ununhexium"). The countdown
  sits in its own element next to it: "Available in 3", "2", "1" while locked,
  then "5 s left" down to "1 s left".
- **A polite live region** announces once per state change, not every second:
  "Confirm available in 3 seconds" when a stage opens, "Confirm now" when it
  unlocks, and the timeout message.
- Each stage starts its own lock and window timers; confirming stage 1 clears
  its timers, so stage 2 never inherits a stale expiry. Cancel, Escape and
  tap-outside cancel the whole flow at any moment, as they do today. An expired
  or cancelled dialog starts again from stage 1, and nothing is requested. Only
  confirming stage 2 inside its live window sends the request.
- Sleep, Wake and the System Power dialogs keep their untimed behaviour:
  `armDelayMs` and `expireMs` are optional fields of `ConfirmCopy`, applied to
  every stage when set.

**Hibernate is not offered.** Windows keeps `hiberfil.sys` at the root of the
system volume and resumes only from there; it cannot be placed on another
drive, and the owner asked for hibernate only if its file could live on `D:`.
Do not add a hibernate button unless that changes.

Done means: the three buttons gate on their capabilities; the timings above
hold under test with fake timers; the shutdown route refuses an unknown id, a
computer without the capability, and a non-Windows platform; no test or
verification ever invokes a real shutdown or sleep. The Computers panel is a
web dashboard surface; the Apple TV and phone apps do not get these buttons.
(Planned on ticket 881062.)

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
