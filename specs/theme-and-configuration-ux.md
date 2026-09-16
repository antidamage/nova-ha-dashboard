# Theme and Configuration UX

Device theme is managed by `app/components/accentColor.ts`.

Storage:

- Local theme key: `nova.dashboard.accent.v1`.
- Config scope key: `nova.dashboard.configScope.v1`.
- Shared theme is stored in dashboard preferences through `/api/theme`.
- Dashboard theme preferences are stored as a theme set:
  `selection: "dark" | "light" | "auto"` plus `themes.dark` and
  `themes.light`. Legacy single-theme payloads are still accepted and are
  normalized into both variants.
- Status Orb visual settings are stored under each theme variant as
  `themes.dark.avatar` and `themes.light.avatar`, and a present per-variant
  avatar is authoritative: its values alone skin that theme's orb. API theme
  reads never merge the single global `dashboard.avatar` into a present avatar
  — doing so made every theme inherit one global gym number colour, so picking
  different themes appeared to swap the gym colour or show another theme's.
  Fields a theme omits are filled with per-field defaults by the client/orb
  normalisers, not by another theme's colours, and a present
  `avatar.gymNumberColor` (including an intentional black/zero-intensity color)
  is preserved. The old `dashboard.avatar` config is consulted only to seed a
  variant that has no avatar object at all (a pre-per-variant install).
- Auto fullscreen is not a theme field. It is a standalone per-device setting
  stored in localStorage under `nova.dashboard.autoFullscreen.v1`; the value
  migrates out of the legacy theme entry on first read. The server still
  strips a legacy `autoFullscreenOnLoad` field from incoming theme payloads.
- The experience mode (§31) is likewise a standalone per-device setting, never
  part of a theme. It is four independent feature toggles — status orb,
  background, camera, and world map. The `/config` "This Device" section
  exposes them as four checkboxes ("Show Status Orb", "Show Background", "Show
  Camera", "Show World Map"); the first-run modal offers the two coarse
  choices (Full Experience = all on, Lite = all off). Toggling any of them
  settles the first-run choice, so the chooser modal never appears afterwards
  on that device.

Theme fields:

- Every theme field below belongs to an individual variant under
  `themes.dark` or `themes.light` in the persisted theme set.
- Accent color.
- Highlight color.
- Background color.
- Background fluid/effect knobs.
- Border color, opacity, and enabled state.
- Map base, water, land, building, road, label, and satellite settings.
- Radar palette, custom radar low/high colors, and radar opacity.
- Reminder glow intensity.
- Dashboard title tone.
- Dashboard title light/dark text colors.
- Status Orb gradient, line, gym counter, and alert colors/opacities.
- Desktop wallpaper landscape/portrait asset references. Portrait targets fall
  back to the landscape asset when the portrait reference is empty.
- Status Orb module selection (`avatar.orbModule`) — which orb module the
  variant renders with (see Status Orb Modules).
- Code defaults write the existing shared theme baseline into both dark and
  light theme variants, including the dark neutral base, purple highlight,
  custom yellow/green radar palette, subdued water overlay, and soft title
  colors. Default selection is Dark for backward compatibility.

Runtime behavior:

- Theme is applied before React render where possible.
- `useDeviceTheme` returns the resolved active `DeviceTheme` for dashboard
  consumers and the full `DeviceThemeSet` for config editing.
- Theme selection controls the active variant. Dark always resolves to
  `themes.dark`; Light always resolves to `themes.light`; Auto uses Home
  Assistant sun state so Dark is shown at night and Light is shown during the
  day. The resolver prefers `below_horizon`/`above_horizon`, falls back to
  `nextRising`/`nextSetting`, then falls back to the local clock if sun data is
  unavailable.
- Dashboard state publishes sun changes to the browser theme hook so Auto can
  switch at sunrise/sunset without requiring a reload.
- CSS variables drive dashboard, map, radar, reminder glow, and title styling.
- Shared scope polls `/api/theme` at the configured interval.
- Local scope syncs through storage events.
- Theme changes dispatch `nova-accent-change`.
- Auto fullscreen is active on the dashboard and config screens when the
  per-device setting is enabled; it checks on mount, common
  page/fullscreen/user events, trusted click/touch/keyboard events captured at
  document level, and every 60 seconds.
- Navigation between the dashboard and config pages uses Next.js client-side
  routing (`next/link`) so moving between pages never unloads the document and
  fullscreen is preserved across page changes.
- The config page has a single Back action for returning to the dashboard.
  Dashboard/theme settings save immediately as they are changed. The Theme
  Library controls remain separate Save/Save As/Load actions for saved theme
  entries and are not dashboard-exit controls.
- Browser DOM fullscreen remains subject to Brave/Chromium user-activation
  rules; a plain page refresh may reject script-requested fullscreen until the
  next trusted in-page gesture.
- `/api/theme` handles dashboard theme updates only. Namespaced theme-set
  writes replace the stored theme set and always carry both dark and light
  variants so hidden config tabs are preserved. Legacy single-theme partial
  writes are still merged for compatibility. Status Orb writes from the config
  page update the active theme variant's `avatar` field.
- Theme saves never push wallpapers to managed desktops. Wallpaper sync is
  triggered explicitly and is screen-aware, so editing the theme in config —
  including selecting a different wallpaper or moving the Theme selection
  slider — sends no desktop command while config is open. There are exactly two
  automatic triggers: leaving the config page (Back) syncs once, and a dark/
  light flip that happens while the main dashboard is open syncs once. The flip
  trigger lives in the dashboard component, so it never fires on the config
  screen.
- Windows targets also get their lock screen replaced, which is what the
  sign-in screen shows behind the password box. It is the same image the
  desktop just received — the landscape asset, or the portrait one on a
  portrait-orientation machine — never a separately chosen asset. It is gated
  on the per-computer `lockScreen` capability, which defaults on (like
  `wallpaper`) and whose toggle only appears for `windows` platforms.
- The lock screen push runs as a second SSH command straight after the desktop
  one, and its file is staged in `C:\ProgramData\NovaManagedDesktop` rather
  than the user's home directory: the sign-in screen is drawn by LogonUI as
  SYSTEM before any profile loads, so it cannot read the desktop copy. Older
  `nova-wallpaper-*` files in that directory are swept on each push.
- The registry writes are `PersonalizationCSP` `LockScreenImagePath` /
  `LockScreenImageUrl` / `LockScreenImageStatus = 1` under HKLM, plus
  `DisableLogonBackgroundImage = 0` so the picture shows at sign-in rather than
  the flat accent colour. PersonalizationCSP is used in preference to the
  `Policies\...\Personalization\LockScreenImage` key because it applies on
  Windows Pro and Home alike. It has the documented side effect of greying out
  the lock-screen picture control in Windows Settings, since Nova now owns it.
- A push then runs the **per-application theme actions** for that platform —
  the mechanism by which a theme change reconfigures individual applications on
  a managed machine, rather than only repainting its desktop. Actions are
  registered in `lib/desktop-theme-actions.ts`, one file per application, and
  each runs in its own try/catch: an application that failed to repaint is
  logged and never fails the sync. Adding an application is a new registry
  entry, not a change to the sync path. See
  `specs/desktop-theme-app-actions.md`.
- The first such action sets Windows Terminal's PowerShell profile `tabColor`
  to the wallpaper's dominant highlight colour, so open terminals take the
  theme's accent. It reads `settings.json` over SSH, patches it as text in
  Node, and writes it back; it never parses the file in PowerShell, because
  Terminal's `settings.json` is JSONC and legitimately contains comments that
  `ConvertFrom-Json` cannot round-trip. Writing the file is itself what makes
  Terminal reload, so a sync that would change nothing does not write at all. A
  one-time `settings.json.nova-backup` is taken beside it. When no PowerShell
  profile can be found the action falls back to the older behaviour: rewriting
  the file's trailing whitespace, in bytes so encoding and any BOM survive, to
  trigger the watcher without the file growing across theme changes.
- The dominant highlight colour is also published on its own, at
  `GET /api/desktop/wallpapers/current/color`, for clients that want the
  theme's accent without downloading and analysing the wallpaper. It is the
  most *vibrant* accent rather than the largest colour cluster, extracted with
  `sharp`; the response carries both the raw colour and a contrast-clamped
  variant. Thresholds and the response shape are in
  `specs/desktop-theme-app-actions.md`.
- HKLM means the SSH session must be an administrator session. The script
  checks its own token first and fails with "Lock screen replacement needs an
  administrator SSH session" rather than part-applying. A failed lock-screen
  push fails the whole sync for that computer, so nothing is recorded as
  applied and the next sync retries both halves.
- Managed-desktop wallpaper sync is de-duplicated. The automatic path (Back and
  dashboard dark/light flip) records the last successfully applied asset
  signature per computer in ignored runtime state under `data/` and skips
  unchanged target/asset pairs, so the same wallpaper image can never be sent
  to a computer twice in a row — an automatic request is dropped when the new
  desktop matches the last one applied. The manual force path — for recovering
  a machine whose wallpaper was changed outside Nova — is reachable from two
  places: the Apply Desktop Wallpapers action in Managed Computers, and the
  "Push Wallpaper To Devices" button in Theme Settings > Background, directly
  under the "Use Wallpaper as Background" toggle. Both post `force: true` to
  `/api/desktop/sync` and report per-machine results. The Background button
  first flushes the debounced shared-theme write, because the sync reads the
  wallpaper from the theme the server holds and a selection made moments
  earlier would otherwise push the previous image.
- The applied-state record includes the lock-screen file name and the
  `lockScreen` capability, so toggling lock-screen replacement re-syncs that
  machine even though its wallpaper asset has not changed. Records written
  before lock-screen support read back with no lock-screen file, which makes
  the first sync after the upgrade push once.
- It also includes a theme-action signature covering every applicable
  per-application action and the colour they were given, so a changed action —
  or a changed extracted colour on an unchanged asset — re-fires them. Records
  written before theme actions read back with no signature, which likewise
  makes the first sync after the upgrade push once.
- A wallpaper sync also calls the theme-change notification webhook, when one
  is configured. Nova cannot push to iOS, so the webhook (Pushcut, in this
  house) raises a notification that runs a Shortcut, and the Shortcut fetches
  `/api/desktop/wallpapers/current/wallpaper.png`. The POST body carries
  `title`, `text`, and `input` — `input` being that fetch URL, so the address
  is not baked into the Shortcut. Its base is `NOVA_PUBLIC_BASE_URL`, whose
  default names the role rather than whichever machine fills it, the same way
  `NOVA_VOICE_HOST_URL` does: a house's own dashboard address is household
  configuration, not a literal in dashboard source. An install that has not set
  it therefore sends an address that will not resolve for it — a soft failure,
  where the notification still arrives and the URL in it is the thing to
  correct.
- The webhook fires on the same triggers as the desktop push and is
  de-duplicated separately, against the theme's own resolved wallpaper rather
  than against any computer: a house with no managed computers still notifies,
  and a theme edit that leaves the wallpaper alone does not. `force` (the
  manual Apply button) notifies regardless, as it re-pushes regardless. A
  webhook failure is logged, never fails the sync, and records nothing, so the
  next sync retries.

Config page:

- Config Source and Fullscreen controls sit at the very top of the config page
  before the accordion list.
- Every config section accordion shows a section-appropriate icon before its
  title, drawn in the title text colour, and all sections (including Camera)
  start collapsed.
- A Theme selection slider sits immediately below those top controls, with
  Dark, Light, and Auto positions.
- Dark and Light tabs sit below Theme selection and switch which theme variant
  is being edited. The Theme Settings accordion is rendered inside the active
  tab, and any theme write saves the full dark/light theme set.
- The remaining top-level sections are ordered as Theme Settings, Climate
  Controls, Hardware Assistant, Secrets, and Config Import/Export.
- Theme Settings contains collapsed sub-accordions ordered as Theme Colours,
  Status Orb, Apple TV, Map, and Reminders inside each theme-edit tab.
- Theme Colours contains the former dashboard component controls as the first
  items, plus the title text tone and light/dark title color widgets.
- Map contains the former map component controls plus Rain Radar settings.
- The active Local/Shared config source button is highlighted with the current
  highlight color.
- A **Design** selector sits directly below the Theme Library block in the
  same section, using the same portalled cyber-listbox. It picks the active
  presentation layer (§33). It has no save/rename/duplicate/delete actions —
  designs are a registry, not a user library.
- `ConfigWorkspace` shows one Back link, hides raw JSON editing and manual
  validation, and exposes config import/export only as Import and Export
  buttons.
- `AccentConfig` edits dashboard theme, reminder glow/audio preview, map
  colors, radar palette, satellite settings, border, and background behavior.
- Reminder glow preview temporarily adds alert styling and plays the uploaded audio
  sample if present.
- `NovaAvatarConfig` edits Status Orb gradient, gradient alert, line colors,
  line opacities, gym number color, gym number opacity, and the gym alert
  threshold in hours as part of the active dark/light dashboard theme.
- `NovaAvatarConfig` opens with an orb module drop-down at the very top of
  the Status Orb section, styled after the theme library's cyber-select
  control (trigger with name/description and chevron, listbox menu, outside
  click/Escape to close). It lists every available orb module — built-ins
  plus host-deployed module files, fetched via `useOrbModules` — and each
  entry carries a thumbnail swatch rendered by the real module renderer in
  the colors of the theme being edited. Choosing a module writes
  `avatar.orbModule` on the theme being edited and the forced preview avatar
  re-renders with the new module immediately.
- `WaveshareWatchfaceConfig` is presented as Hardware Assistant and only shows
  hardware assistant controls such as the watchface idle/power timer. The old
  gym counter readout is removed from this section because gym alert config is
  managed in Status Orb.
- `StatusOrbInfoConfig` ("Status Orb Info") owns the readout: a grouped
  `ConfigSelect` module picker, a live preview rendered through the real
  formatter, and only those display controls the chosen format actually uses
  (unit, decimals, rounding, unit symbol and sign; clamp/count-down for
  percentages; 12-hour/seconds for clocks), plus a picker for each parameter the
  chosen module declares — a room list, a sensor list showing each sensor's
  current value and unit, a date field, or a slider. The gym alert-hours slider
  stays here and appears for the gym modules. Selecting `None` collapses the section
  to the picker and the orb renders with no readout.
- The forced config preview avatar always renders the gym-alert pulse so the
  configured alert color can be inspected even when the real counter is below
  the alert threshold.

Color decision:

- Project memory records that dashboard controls and chrome should use the
  established dashboard UI color tokens/variables. Future changes should not
  introduce arbitrary new control colors. Power graph curve colors are an
  accepted exception.
