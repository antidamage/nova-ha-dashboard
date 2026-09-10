# System 9 UX control library

Produced from a mockup set at `D:\Downloads\system 9 UX` (16 AI-generated
renders, garbled labels, several near-duplicate colour variants across two
layout families). Renders are colour/material reference only, not literal
layout specs. This spec is the source of truth for `nova-ui-system9/`, a
standalone, reusable React/TS component package — **not** part of
`nova-household` (which is a code-free config overlay; see rationale below)
and **not wired into the live `nova-ha-dashboard` UI** — this is a
demo/showcase library for now.

Plan: `wiggly-gathering-cake` (`~/.claude/plans/wiggly-gathering-cake.md`).

## Package location

`D:\Projects\Agent\nova-ui-system9\` — a standalone TypeScript/React
component package with its own `package.json`. Not an npm/pnpm/yarn
workspace member (no sibling project in this repo uses workspaces). Ships
its own Next.js showcase app (`app/` router) so it can be run standalone
with `npm run dev`; the component source lives in `src/components/` so a
future consumer (e.g. `nova-ha-dashboard`) can import from
`nova-ui-system9/src/components/*` directly or via a package copy/link.
Lives inside the main `D:\Projects\Agent` git repo (commit-every-change
convention applies, same as every other subproject here) — it doesn't need
independent distribution today, so a separate repo isn't justified.

Why not `nova-household`: that folder holds only `README.md` and
`dashboard-config.json` and is deliberately kept free of code —
`nova-ha-dashboard/lib/no-household-data.test.ts` fails the build if
household-shaped code/literals leak into dashboard source. It is a
per-install config overlay, not a shared component package. Putting a UI
library there would violate that repo's own stated invariant.

## Theme tokens

Two palettes, sampled directly (pixel-sampled with PIL, not eyeballed) from
the two reference renders. CSS custom properties under `data-theme="dark"` /
`data-theme="light"` on a root wrapper, following the same
attribute-driven pattern `nova-ha-dashboard` already uses for its own
dark/light theming (`lib/theme-values.ts`, `themes.dark`/`themes.light`).

### Dark — sampled from `image (40).jpg`

| token | value | sampled from |
|---|---|---|
| `--s9-app-bg` | `#232428` | outer app background |
| `--s9-panel-bg` | `#212528` | card/panel body |
| `--s9-panel-border` | `#2c3033` | panel edge (footer strip sample, close to panel_bg but lighter — use as the drawn border, not a literal edge pixel since renders anti-alias borders into the bg) |
| `--s9-row-bg` | `#202427` | list-row background |
| `--s9-tab-active-bg` | `#586882` | active tab (blue-grey) |
| `--s9-tab-inactive-bg` | `#616163` | inactive tab |
| `--s9-lcd-bg` | `#efeff1` | recessed numeric readout glass |
| `--s9-lcd-fg` | `#1b1d1f` | readout digits (derived: near-black against `--s9-lcd-bg`) |
| `--s9-text` | `#e7e8ea` | primary label text (derived: light-on-dark, panel_bg's contrast partner) |
| `--s9-text-dim` | `#9a9da3` | secondary/caption text (derived) |
| `--s9-accent-on` | `#3f9142` | rocker/LED "on" green (derived from the light-theme green_on `#60b850`, darkened ~15% for the dark surface's contrast) |
| `--s9-accent-blue` | `#5b7bd6` | active-state accent (derived from tab_active_bg, saturated) |
| `--s9-bevel-hi` | `rgba(255,255,255,0.08)` | highlight gradient stop (derived, not literal-sampled — bevel highlights are sub-pixel in the source jpgs) |
| `--s9-bevel-lo` | `rgba(0,0,0,0.45)` | shadow gradient stop (derived) |

### Light — sampled from `image_26511423.jpg`

| token | value | sampled from |
|---|---|---|
| `--s9-app-bg` | `#a2a2a2` | outer app background |
| `--s9-panel-bg` | `#d1d1d1` | card/panel body |
| `--s9-panel-border` | `#cacaca` | panel edge |
| `--s9-row-bg` | `#e9e5e6` | list-row background |
| `--s9-titlebar-bg` | `#353334` | pinstripe titlebar dark ground |
| `--s9-titlebar-stripe` | `#aaaaaa` | pinstripe line colour |
| `--s9-tab-active-bg` | `#4d4b4c` | active zone/tab button |
| `--s9-tab-inactive-bg` | `#626260` | inactive zone/tab button |
| `--s9-lcd-bg` | `#e0dee3` | recessed readout / off-switch track |
| `--s9-lcd-fg` | `#1b1d1f` | readout digits (derived) |
| `--s9-text` | `#242424` | primary label text (derived, dark-on-light) |
| `--s9-text-dim` | `#5c5c5c` | secondary/caption text (derived) |
| `--s9-accent-on` | `#60b850` | rocker/LED "on" green (sampled) |
| `--s9-accent-blue` | `#4a5fae` | active-state accent (derived, same hue family as dark theme's accent-blue for parity) |
| `--s9-bevel-hi` | `rgba(255,255,255,0.55)` | highlight gradient stop (derived) |
| `--s9-bevel-lo` | `rgba(0,0,0,0.22)` | shadow gradient stop (derived) |

Both themes additionally define `--s9-radius-sm` (4px), `--s9-radius-md`
(8px), `--s9-radius-lg` (14px), and a shared `--s9-font` (system-ui stack —
the mockups use a plain sans, no need to invent a custom face).

## AO / lighting layer system

Every control composes from its own shape/colour plus two shared overlay
layers, applied via a `<Lighting>` wrapper component
(`src/components/primitives/Lighting.tsx`):

- **AO layer** (`.s9-ao`): `position:absolute; inset:0; pointer-events:none;
  mix-blend-mode:multiply;` — a `radial-gradient`/`linear-gradient` (per
  control shape: radial for round knobs/buttons, linear for bars/panels)
  darkening edges and inset corners. Strength via `--s9-ao-strength`
  (0–1, default 0.35).
- **Specular layer** (`.s9-spec`): same box, `mix-blend-mode:screen`, a
  soft gradient highlight biased toward the top-left (matches the light
  direction visible across every mockup). Strength via `--s9-spec-strength`
  (default 0.25), angle via `--s9-spec-angle` (default 135deg).

`<Lighting shape="round|rect|pill" strength={…}>{children}</Lighting>`
wraps a control's visible shape and renders the two overlay divs after it,
sized via `inset:0` to the wrapper — no per-component bespoke gradient CSS
needed; controls only set the two CSS custom properties when they need to
deviate from default (e.g. the LCD readout uses a stronger inset AO, since
it reads as recessed rather than raised).

## Control inventory

For each: default component name in `src/components/`, states, and
notable behaviour. All are controlled components (value + onChange), no
internal fetch/side effects — this is a pure UI library.

1. **`TabBar`** — segmented row of `TabButton`s. States: active (raised,
   accent-tinted, inset lit), inactive (flat), hover, disabled. Also serves
   the "zone selector" mockup variant (same component, different labels).
2. **`Panel`** — group fencing. Prop `skin: "plain" | "pinstripe"`. Plain =
   flat title text on a recessed frame. Pinstripe = classic-Mac titlebar
   (repeating-linear-gradient stripe pattern) with a small `CloseBox`
   checkbox glyph on the left, disclosure state optional (`collapsible`
   prop rendering a triangle + "Expand" toggle, per the Lights-dashboard
   mockup variant).
3. **`WindowFrame`** — outermost chrome: pinstripe titlebar with a title
   string, a `ScrollBar` down the right edge, content slot. Composes
   `ScrollBar` (#14) rather than re-implementing it.
4. **`RadioPillGroup`** — inline `○ Label` items, one active. Keyboard:
   arrow-key navigation between pills (standard radio-group a11y).
5. **`ToggleSwitch`** — On/Off capsule, thumb slides, label state text
   optional (`showLabel` prop for the "On"/"Off" caption inside the pill
   as seen in the Lights-dashboard rows).
6. **`RockerSwitch`** — wide On/Off rocker. On = `--s9-accent-on` fill +
   soft glow (`box-shadow` bloom, not just a colour change — matches the
   backlit look in the mockups).
7. **`DimmerKnob`** — small read-style dial: rotates a tick mark by
   `value` (0–100 → -135deg..135deg sweep), flanking `+`/`−`
   `StepperButton`s (#10) reused, not reimplemented.
8. ~~`ColorEncoder`~~ — retired 2026-09-10, see below.
9. **`Slider`** — horizontal filled-track + round thumb. Optional end
   labels (`startLabel`/`endLabel` props, e.g. "Low"/"High"). Pointer-drag
   + click-to-position + arrow-key nudge.
10. **`StepperButtons`** — up/down arrow pair, `onIncrement`/`onDecrement`,
    supports press-and-hold repeat (standard stepper a11y pattern).
11. **`Readout`** — recessed LCD-style numeric display. Props: `value`,
    `unit` (e.g. `"%"`, `"°F"`, `"kW"`), `size: "sm"|"md"|"lg"`.
12. **`IconButton`** — large square button, glyph slot (SVG children) +
    caption line below. Active/pressed state = deeper inset AO.
13. **`StatusChip`** — coloured dot (`status: "ok"|"warn"|"off"`) + label
    text.
14. **`ScrollBar`** — vertical track, thumb, up/down arrow caps at each
    end. Controlled (`value`, `viewportRatio`, `onChange`) so `WindowFrame`
    can drive it from actual scroll position.
15. **`SubZoneSlider`** — horizontal scrollbar-styled control: prev/next
    `StepperButtons`-style arrow caps either side, a knurled-texture grip
    (repeating linear-gradient hatch) that drags between label stops
    (labels rendered below, one active/bold at a time — snaps to nearest
    label on release).
16. **`ColorWheelPalette`** — hue ring (`conic-gradient`) with a
    saturation/lightness gradient puck rendered inside via layered radial
    gradients (white→transparent, transparent→black), a draggable
    selection dot, a swatch grid below (fixed palette, click to select),
    and a current-colour chip. Independent from `ColorEncoder` — this is
    the flat 2D picker seen in the mockup grids, not the rotary knob.
17. **`Sparkline`** — small inline SVG line/area chart, props `data:
    number[]`, `label`. No axes/gridlines drawn (matches the mockup's bare
    trend-line look) — this is a glanceable trend, not a full chart.
18. **`FooterBar`** — composite: `IconButton` (Home) + a two-item button
    row ("All Lights Off"/"All Off") + `Readout` + `StepperButtons`
    (Master Dimmer). Composes existing primitives; no new visual surface.

(Room-preview thumbnails and literal desk/photo backgrounds seen in some
mockups are decorative bitmap content, not controls — excluded.)

## Retired: `ColorEncoder`

Adeline, 2026-09-10: the system9 `ColorEncoder` was a poor first attempt and is
not reused. It was deleted from this package. The rotary colour control now
lives in the dashboard itself — `app/components/ColorEncoder.tsx`, specified in
`specs/color-encoder.md`.

## Showcase page

`nova-ui-system9/app/page.tsx` (or `app/showcase/page.tsx`) renders every
control from the inventory above, grouped by category (Navigation & Frames,
Switches & Toggles, Sliders & Dimmers, Readouts & Status, Color, Charts),
with a dark/light theme toggle at the top (`data-theme` swap on a wrapper),
each control shown with at least two states side by side where states
exist (on/off, active/inactive tab, etc). This page is the reviewable
deliverable — no routing/nav complexity beyond the one page and the theme
toggle.

## Verification

- `npm run build` and `tsc --noEmit` clean in `nova-ui-system9/`.
- Showcase renders all 17 remaining inventory items in both themes, no console
  errors, AO/spec overlay layers visibly present on every raised/recessed
  surface.
