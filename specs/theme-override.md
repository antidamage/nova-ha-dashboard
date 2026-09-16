# Theme override (per device)

Adeline, 2026-09-15. Plan `we-ve-separated-the-landscape-s-ancient-parnas`
round 2, task log `20260914T101019Z-06c0031b`.

## The button

- An icon-only button on the main dashboard, **left of the config button**.
- Tapping cycles: **unset → auto → light → dark → unset**.
- Icons (lucide): unset `Contrast`, auto `SunMoon`, light `Sun`, dark `Moon`.
  No text label; `aria-label` and `title` name the state ("Theme: follows
  config", "Theme: auto", "Theme: light", "Theme: dark").

## Behaviour

- **Local to this device.** Stored in `localStorage`
  (`nova.dashboard.themeOverride.v1`). It never writes the global theme setting
  and is never sent to the server.
- `unset` removes the key, and the dashboard follows the global
  `ThemeSelection` from config. `auto`, `light` and `dark` override it on this
  device only; `auto` resolves by the sun exactly as the global `auto` does.
- The config page shows and edits the global setting as before.

## Header buttons

- The config button becomes the **cog icon only** (no "Config" text), in the same
  position with the same accessible name.
- Order along the top (portrait) and in the sidebar (landscape): **Reload, theme
  override, config cog**. Reload moves to the left of the theme button.
- The landscape sidebar fade rules apply to all three.

## Done means

- Cycling through the four states changes the page theme immediately and
  survives a reload; unset follows a change made on the config page.
- Another device is unaffected.
- The cog has no text; Reload sits left of the theme button.
