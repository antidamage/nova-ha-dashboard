# Lighting tint

The dashboard and config pages can take on the colour of the room's lights: a
flat, colour-blended layer over the whole page, including modals, that input
passes straight through.

Requested by Adeline 2026-09-11. No plan run produced this spec; it was written
at the start of the implementation session.

## Setting

- Lives in the saved theme, per variant, like `mapSatellite`: two `DeviceTheme`
  fields, so a library entry carries it.
  - `lightingTint: boolean` — default `false`.
  - `lightingTintStrength: number` — percent, 0–100, step 1, default 30. It is
    the layer's opacity.
- Belongs to the `themeColours` copy/paste section.
- Editor: the Theme Colours group in Theme & Experience.
  - `CheckboxRow` labelled **Tint dashboard to match lighting**.
  - `SliderControlPanel` **Tint Strength**, always shown directly under it.
- Applied as root state by both theme appliers (the pre-paint script in
  `app/layout.tsx` and `applyDeviceTheme`):
  - `html[data-lighting-tint="on"|"off"]`
  - `--nova-lighting-tint-strength` (the percent, unitless)

## Which lights a device follows

Configuration, not code (dashboard golden rule: no device or room is
special-cased). Each device picks its zone in Theme & Experience → This Device
→ **Lighting Tint Follows**, a `ConfigSelect` of the whole house plus every
non-special zone that has lights.

- Stored per device like Auto Fullscreen: localStorage
  `nova.dashboard.lightingTintZone.v1`, never part of a theme.
- Default: the whole house (`everything`).
- A stored zone that no longer exists falls back to the whole house.

Adeline's setup: kiosk, Ununhexium and the iPad set to Lounge; the iPhone left
on the whole house.

Colour:
- **Room** — the zone's displayed colour, `spectrumFromZone(zone).preview`, the
  same colour the zone's dial shows (most-represented colour among lit lights,
  brightest as tie-break).
- **Whole house** — the brightness-weighted mean RGB of every lit light that
  reports a colour.
- Nothing lit, or no light reports a colour → the layer fades out.

## Layer

- `position: fixed; inset: 0; pointer-events: none;` at the maximum z-index,
  mounted once in the root layout, so it covers the dashboard, config pages,
  and every portalled modal or popover.
- `mix-blend-mode: overlay`, flat `background-color` of the source colour.
- Opacity = strength / 100 while lit and enabled, else 0.
- Colour and opacity ease over 1.2 s so light changes fade rather than jump.
- `aria-hidden`; it never receives focus or input.
- While the setting is off the layer does not fetch or subscribe to state.

## Data

- Initial `/api/state` fetch, then the shared `/api/events` `state` push
  (`subscribeToDashboardEvents`) — no new connection.

## Done

- Ticking the box on the config page tints that page immediately; the dashboard
  follows on its next theme apply.
- Taps, drags and scroll behave identically with the layer on.
- The layer sits above an open `ModalOverlay`.
- Lights off → no tint. Phone follows the house; larger screens follow the room.
