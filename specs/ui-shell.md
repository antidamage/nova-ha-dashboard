<!-- START HERE, never here alone: read D:\Projects\Agent\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# UI shell, navigation and zones

Produced by the plan `2026-09-26_080857-dashboard-no-reload-on-foreground.md`.

## UI Shell

`app/layout.tsx` defines the base document:

- Metadata title is `Nova Control`.
- Metadata declares Apple touch icon links for 57x57, 60x60, 72x72, 76x76,
  114x114, 120x120, 144x144, 152x152, 167x167, and 180x180 PNG assets, plus
  the default `/apple-touch-icon.png`. These assets are generated from
  `D:\Projects\Agent\nova-appletv-dashboard\apple-tv-icon.png` using a
  centered square crop and resized per output size.
- Global CSS is loaded.
- `NovaAvatar` is mounted at the body level.
- Inline script prevents context menus.
- Inline script hydrates device theme before React renders by reading
  localStorage, cookies, or shared theme.
- CSS variables are set for accent, highlight, background, border, map, radar,
  reminder glow, title tone, and satellite state.
- Theme cookies preserve config scope and theme values.

`app/page.tsx` renders `DesignHost`, which mounts whichever **Design**
(presentation layer) is active; `Dashboard` below is the `nova-classic`
Design's root. See §33.

`app/components/Dashboard.tsx`:

- Reads dashboard state through `useDashboardState`.
- Uses `useDeviceTheme`.
- Runs the return-to-foreground reload policy (see "Reloads on a returned page").
- Restores selected zone from localStorage.
- Runs the auto-fullscreen watchdog when the per-device fullscreen setting
  enables it.
- Builds a navigation tree for Home/Everything, indoor rooms, climate, outside,
  network, Grid, and Reminders.
- Shows `TasksPanel` when the Reminders zone is selected.
- Shows `ZoneControls` for all other zones.
- Shows warnings and transient toast feedback.
- Provides a top-right `Config` link to `/config` without moving the Nova
  avatar.
- The clock panel shows Auckland time and date only; the date is intentionally
  large and no secondary Vancouver/world time is shown.
- Preloads rain radar tiles and refreshes map/radar resources on theme changes.

Client state behavior:

- Initial state is loaded from `/api/state`.
- A polling fallback runs every 5 seconds.
- State refreshes on focus, online, visibility/pageshow, and SSE updates.
- Optimistic entity and zone updates are applied for light interactions.
- Polling can be paused during light command holds and resumed afterward.
- Remote-setting UI controls that derive their displayed value from polled or
  SSE state must pause remote value adoption after local user input. Each
  implementation defines its own timeout; lighting controls use 10 seconds so
  slow Home Assistant refreshes do not rubber-band sliders or pickers while a
  command is settling.
- Climate entity actions, including the panel heater, apply optimistic UI state
  and hold dashboard refreshes for a longer settle window before the follow-up
  refresh so slow Home Assistant device reads do not rubber-band the controls.

### Reloads on a returned page

Three things in this shell can reload a page, and a page that has been in the
background must come back exactly as it was left: none of them may fire because
the page returned.

| Watchdog | File | Rule |
|---|---|---|
| Stall reload | `app/components/dashboard/state/useStallReload.ts` (pure decision in `state/stallReload.ts`) | Reloads only after five minutes of **visible** ticks with no server snapshot, and starts over when the gap between ticks shows the page was away (more than three tick intervals, so a page that is merely throttled in the background still carries its counter), and after a hidden stretch longer than a couple of ticks, so time the page spent hidden can never become visible stall on the way back. Time the page spent hidden never accumulates into it, and a page that blanks mid-stall keeps the stall it had nearly accumulated. |
| Build-change reload | `app/components/buildReloadPolicy.ts` (the rule) with `app/components/useBuildReload.ts` (the wiring) | Hidden: reload, one grace period (`HIDDEN_RELOAD_GRACE_MS`) after the page goes — a hidden moment can also be the document leaving, so the reload is scheduled, re-checks that the page is still hidden when the grace expires, and a terminal `pagehide` cancels it. A bfcache freeze stops that timer, so a frozen page is restored visible and its change is applied at the page's next hidden transition, exactly like any other deferral. Visible and the page has been hidden at some point: remember the new build and apply it at the next transition to hidden. Visible and never hidden (the kiosk): reload now, as it always did. |
| Outage recovery | `app/components/system/SystemActivityBlocker.tsx` | Unchanged: reloads a page that witnessed an outage, behind the overlay it is already showing. It compares the served build against `getRunningBuildId()` — the build this page is **running** — so a page holding a deferred build change is still brought current by a release. |

Rules that go with them:

- The promise is that a page is never reloaded bare *because it returned*:
  it reloads off-screen, or behind the blocker overlay it is already showing.
  Two reloads happen with the page on screen and are not this rule's business:
  a wall display that has never been hidden is reloaded as it always was, and
  a page that is genuinely wedged while visible still gets its last-resort
  reload. What must never happen is a reload triggered by the act of coming
  back. One class is deliberately not recovered: a page whose own timer is
  starved past the gap threshold resets its stall on every tick, because a
  gap between ticks cannot tell a suspended page from a blocked main thread —
  and rescuing the former is what the rule is for.
- What the page knows is the DOCUMENT's, not one mounted copy's: the shell
  mounts the reload hook from more than one component, so its state lives in
  one module and one hide produces one reload. A copy that adopted a build
  another copy was holding as deferred would make the outage blocker's
  comparison a no-op exactly when an on-screen page needs a release.
- The stall reload carries its counter across a hidden tick rather than
  wiping it: the hidden time must not count, but a screen that blanks for a
  second mid-stall must not lose the stall it had nearly accumulated either.
- The stylesheet cache-breaker only re-requests the CSS of the build the page is
  running; a foreign id must not re-request it, because a release moves the live
  root and that URL no longer resolves.
- Every automatic reload records itself before navigating, in `sessionStorage`
  under `nova.dashboard.reloadReason.v1` and as a `dashboard`/`auto-reload` event
  on the monitoring stream, and each page load reports `document.wasDiscarded`
  with the previous reason (`dashboard`/`page-load`). That is what distinguishes
  this page's own reloads from a tab the browser discarded — a cause no change
  here can reach.

### Slider Style

Every linear draggable control in the dashboard shares one rectangular slider
style so the dashboard, config pages, and camera controls look consistent. The
style is implemented by the shared `DotLineControl` component (which backs light
brightness, aircon fan speed, the camera processing sliders, theme sliders, and
all `SliderControlPanel` controls) and is mirrored by the Radix-based DVR
scrubber (`.camera-slider`). All slider colours come from the device theme CSS
variables, so they retint with the active theme.

- Track: a rectangular bar, as tall as the thumb, filled with the background
  colour (`--cyber-bg`) and outlined in the border colour at the configured
  border opacity (`--cyber-border-dim`).
- Thumb: a filled rectangle in the accent colour (`--cyber-line`), the same
  height as the track and outlined in the border colour at the configured border
  opacity (`--cyber-border-dim`) so the thumb and track outlines align. While the
  control is focused or being dragged, the thumb becomes a solid highlight-colour
  rectangle (`--cyber-highlight`) with no outline.
- Back-fill: an optional tinted area from the start of the track to the thumb,
  drawn in the accent colour. It is used for magnitudes that "fill up", such as
  brightness, intensity, and the camera processing sliders, and is omitted for
  stepped choices such as fan speed where the track stays a single colour. The
  `fill` prop toggles it; `SliderControlPanel` defaults it on because config
  sliders are magnitudes.
- Disabled: the thumb becomes an outlined rectangle in the border colour filled
  with the background colour, and the back-fill is dropped, leaving only the
  background-filled, border-outlined track.
- Config-page sliders have a strict save-on-release contract. Every
  `SliderControlPanel` requires separate `onPreview` and `onCommit` callbacks:
  drag ticks may update local visual state only, while release sends exactly one
  persistence request. Config sliders must never send network writes during a
  drag. Live interactive commands are reserved for dashboard controls.
- While a control is active, and for six seconds after release, dashboard and
  config reconciliation polling/pushes cannot replace its local value.

## Navigation and Zones

Special zones:

- `everything`: whole-home/inside Home zone built by the server.
- `power`: rendered as `Grid`.
- `tasks`: rendered as `Reminders`.
- Configured network zone, rendered with router status.
- Climate zones, detected by configured climate area names and climate devices.
- Outside zones, detected by outside area/entity naming.

Zone buttons display:

- Zone name.
- Domain/entity counts.
- Context icons for lighting, climate, network, power, and tasks.
- Network live/offline status when applicable.
- Grid live kWh context.
