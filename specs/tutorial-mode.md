<!-- START HERE, never here alone: read C:\workspace\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Tutorial mode

alex, 2026-11-16. Ticket 121705. A guided walk-through of the dashboard's
controls, with a "How was this control built?" view that fans a control's
render layers apart. It runs on the demo site and on the real dashboard.

## Opening and closing it

- A **"?" button** in the corner chrome, beside the Config cog
  (`DashboardChrome.tsx`), same size and treatment as that cog. Present on
  every build: demo and live. Hidden on `/config`, as the cog's neighbours
  are.
- Exit by the **close box** (a small "×" at the top right of the caption
  panel), by **Esc**, or by **Next** on the last step. Exit leaves the page
  as it found it: any fold the tour opened is closed, the sandbox copies are
  unmounted, the scroll position stays where the user left it.
- Nothing about the tutorial persists. A reload always starts outside it.
- **Idle exit: 60 seconds, on the live dashboard only.** The demo build
  (`NEXT_PUBLIC_NOVA_DEMO_MODE`) has none, because a visitor there is meant to
  sit and watch. On the live dashboard the 60 seconds count from the later of
  the last real input (pointer, touch, wheel, scroll, key, Replay) and the
  moment the finger finished its loops, so someone watching a step is not
  thrown out mid-gesture. When it fires it runs exactly the Close path (copies
  unmounted, real controls restored, folds the tour opened closed, scroll
  kept), so a mis-tap on a wall panel frees the house controls within a
  minute.
- The "?" is fixed-position like its neighbours and reflows nothing. It is not
  gated behind a setting: alex asked for it on the dashboard itself
  (2026-11-16, "add a button to the dashboard that's a question mark for the
  tutorial").
- Web dashboard only. The Apple TV app has no tour.

## The mask

- Everything except the control being explained is covered. The light
  variant uses **black at 85%**; the dark variant uses **white at 75%**
  (alex, 2026-11-16: "for dark mode we'll white-out the background (75%
  opacity)"). The variant is the one painted, `:root[data-theme-variant]`.
- The uncovered area is a rounded cut-out round the control's box plus a
  12px margin, with a soft 8px edge. It eases between steps over 450ms.
- **The page still scrolls, but nothing under the mask can be pressed.** The
  mask itself is `pointer-events: none`, so wheel and touch scrolling reach
  whichever sub-panel or page is under the finger. A guard on `window`, in
  the capture phase (so it runs before React's root listener and before every
  control's own listener), acts only on **trusted** events whose target is
  outside the tour's own elements and the sandbox copy. It never calls
  `preventDefault` on touch events, so native touch scrolling still runs, and
  it never touches wheel events. It has two strengths:
  - **Live dashboard: strict.** It stops every `pointerdown`, `pointerup`,
    `mousedown`, `mouseup`, `click`, `dblclick`, `touchstart`, `touchend`,
    `contextmenu` and `keydown`. It does not enumerate interactive elements: a
    dial is a `div`, and the guard covers it the same as a button. The wall
    panels are touch screens, so the mouse click-drag scroll it costs there
    is not used. Its decisions are unit-tested (`inputGuard.test.ts`); the
    e2e (`e2e/tutorial.spec.ts`, demo build) presses a real climate knob and
    a preset with the tour open and asserts neither moves and no non-GET
    request is made across the whole tour.
  - **Demo build: scroll-friendly.** The demo drives no devices, and its
    visitors are mostly on a mouse, so the landscape layout's two-axis mouse
    drag scroll (`useClickDragScroll`) must keep working. It stops every
    `click`, `dblclick` and `keydown`, and stops `pointerdown`, `mousedown`
    and `touchstart` only when they land on a control (a button, link, input,
    `[role=slider]`, `[role=switch]`, `.rotary-encoder`, `.nova-avatar-host`).
    A rendered check drags the landscape page with the mouse while the tour is
    open.
- On a phone in portrait the copy can fill much of the screen; a swipe that
  starts on it works the copy, and the page scrolls from a swipe on the
  dimmed margin outside it.
- A tap on the dimmed area does nothing but flash the close box once
  (300ms), so the way out is always findable.
- Tab stays inside the tour (a focus trap) while it is open.
- The cut-out follows the control. Its rect is re-read on scroll (any
  scroller, capture phase), resize and a `ResizeObserver` on the control, and
  runs `requestAnimationFrame` only while one of those is firing — never a
  constant per-frame loop.
- **On step entry the control is scrolled into view** (its nearest scroller,
  only as far as it takes). If the user scrolls it fully out of view, the caption panel shows
  a "Back to the control" button that scrolls it back.

## The walk-through

### Sandbox copies, never the real devices

Every demo plays on a **deviceless copy** of the control, the same component
the card uses (`LightEncoder`, `TemperatureEncoder` through
`DemoTemperatureDial`, `IconButton` for the presets, `OrbDialIndicator`),
mounted exactly over the real one at the same size and holding local state
only. The copy tracks the real control's rect (by the same rule as the
cut-out), so it scrolls with it. **No command leaves the dashboard during the
tour**, on the real house or on the demo, **by construction**: the copies are
built from the deviceless components only (`LightEncoder` with local state,
`DemoTemperatureDial`, `IconButton` with local handlers, the orb renderer
with `useOrbDial` given local ids and no-op dismiss/toggle). No file under
`app/components/tutorial/` imports a command hook, a store that writes, or
`fetch` — not `useAirconCommands`, `useBedroomHeaterCommands`,
`useZoneLighting`, `zoneLightRulesClient`, `climateCommands` or
`useDashboardCommands`. A unit test reads the package's import graph and
fails on any of them, and no tour file calls `fetch`. The fold step opens the real fold, whose open state
is local component state and never persisted (`specs/advanced-fold.md`), and
the tour closes it again.

**Synthetic gestures.** The finger dispatches `PointerEvent`s with
`pointerType: "touch"`, `isPrimary: true` and a fixed `pointerId`, and, for
the fold, the `MouseEvent`s its drag listens to. Pointer capture on a
synthetic pointer throws `NotFoundError`, so `RotaryEncoder` and
`useOrbDial` capture through a guarded call that ignores that error (the one
change to shared controls PR 1 makes). Nothing the copies listen to checks
`isTrusted`.

**Quiet while it plays.** While the finger is driving, UX sounds and haptics
are suppressed (`controlSound.ts` and `haptics.ts` gain one suppression flag
the tour sets), so a looping demo never chimes on a living-room display.
When the user works the copy by hand, sounds and haptics play as normal.

The copies take **no props from live or simulated state** beyond layout (the
real control's size and rect) and the theme, so the demo's live simulation
never re-renders a copy mid-gesture. They start from fixed values, and each
copy carries a small **"DEMO" tag** (the `rect-envelope-tag` label style)
so nobody walking past a wall panel reads a copy's invented target as the
room's.

While a copy covers it, the real control is `visibility: hidden` and `inert`
(its layout box kept), so there is never a doubled edge, a second set of
numbers showing through, or a duplicate in the focus order or the
accessibility tree. It is restored when the step ends.

**Target resolution.** A step's target is the first matching element in page
order that is laid out (non-zero size). When none exists (a site with no
aircon, no light card, no fold) the step is **skipped**. The steps are
resolved once when the tour opens, and again on a layout flip, and the
counter is computed from that list, so it never reads "4 / 9" and then jumps
to 6. Steps whose feature is switched off on this device are skipped too,
with their layer view: the orb steps when
the status orb is off, the background step when the background is off
(`specs/experience-modes.md`). Lite mode runs the tour with those skips, and
its layer views never create a WebGL or canvas context.

The targets, by their existing hooks: the first light knob
(`.zone-color-encoder`), the first preset row (`.zone-lighting-presets`),
the first aircon knob (the `TemperatureEncoder` whose dial is labelled
"… air conditioner"), the status orb host (`.nova-avatar-host`), the first
closed `.advanced-fold` with a divider. The tour never navigates to another
zone to find one.

### The finger

- A drawn fingertip (a soft round pad, 44px, the theme's text colour at 70%,
  with a darker press ring that shrinks in while pressed) moves along each
  gesture **slowly**: a tap is 300ms down, a drag moves at about 60px per
  second, with a 600ms rest between parts.
- It **drives the copy with synthetic pointer events** at its own position,
  so the real component code handles the gesture and the copy reacts exactly
  as the real one would.
- Each step's gesture plays **three times**, with a 1.2s rest between, the
  copy resetting to its starting state each time, then stops with a
  **Replay** button in the caption panel.
- The user may also use the copy by hand. A real (trusted) press on the copy
  **cancels the finger** for that step at once: the step shows Replay, and
  the finger never resumes on top of the user's own state. Replay resets the
  copy and plays again.
- **Reduced motion**: the finger jumps between the gesture's key points
  instead of gliding, and the mask does not ease.

### Steps, in order

| # | Step | Copy | What the finger does | Caption |
|---|---|---|---|---|
| 1 | Welcome | none; the cut-out is the "?" button | — | What the tour covers; Back/Next and the close box. |
| 2 | Tap vs turn | light knob | taps once (the lit light moves), then turns | A tap picks what the knob sets; turning changes it. Turn like a real knob: from where you grab it. |
| 3 | Light: brightness | light knob, Brt lit | turns from 7:30 towards 4:30 | Brightness is lit when the knob loads. The band fills to the mark in the light's colour. |
| 4 | Light: colour | light knob | taps to Hue, turns; taps to Sat, turns | Hue goes all the way round; saturation runs from white to full colour. |
| 5 | Light presets | preset row | taps On, a preset, then Off | The row under the dial: On, the zone's rules in order, Off. |
| 6 | Unlocking a dial | aircon knob, locked | one deliberate tap; the unlock ring lights and the rings unfold | Climate knobs lock themselves when idle so a brush can't change them. One tap unlocks; they lock again after a quiet spell or a tap elsewhere. A drag or a long hold does not unlock. |
| 7 | Target and modes | aircon knob, unlocked | turns the target; taps through Auto, Manual, Off | Turning sets the target. A tap cycles Auto, Manual and Off. The ring shows the target across the top and the room across the bottom. |
| 8 | Fan ring | aircon knob in Manual | drags the Fan thumb along its ring | Each ring is dragged by its thumb. A press on the track away from it does nothing. |
| 9 | Mode ring | aircon knob in Manual | drags the Mode thumb through cool, fan, heat | The Mode ring picks what the unit does. |
| 10 | Fresh air and timer | aircon knob | taps the Fresh Air ring; drags the Timer thumb | A toggle ring flips on a tap. The timer counts down and switches the unit off. |
| 11 | Status orb | orb copy | taps the orb; turns through the entries; taps it closed | The orb shows the most important thing first. A tap opens the stack; turning moves through it. |
| 12 | Advanced | the first fold divider, real | drags the panel past the divider until the fold opens, then lets it close | More settings live past the ADVANCED line. Pull past it to open. (The advanced areas are being redesigned, so the tour stops at the line.) |
| 13 | Background | the whole page, mask lifted | — | The background is a live shader. |

Step 12 uses the real fold, because opening it changes only the view. Its
target is the first **closed** fold in page order. The tour closes only the
folds it opened, when the step ends or the tour exits; a fold the household
already had open is left as it was. Nothing inside an advanced area is
touched or explained: the pull starts on the divider line at a point that is
not on a control, and the fold is closed by scrolling it back to the offset
it had while closed (its own re-lock), never by a second drag that could
start on something inside it.

### The caption panel and bottom bar

- The caption panel holds the step title and one or two sentences. It sits
  on the side of the cut-out with more room: below or above it in portrait,
  beside it in landscape; never over the cut-out.
- The **bottom bar** is fixed to the bottom of the viewport, inside the safe
  area: **Back** at the left, the step count ("3 / 13") in the middle,
  **Next** at the right ("Done" on the last step). The bar is at least 56px
  tall, buttons 48px minimum.
- The **close box** is a 32px "×" at the panel's top right corner, 44px hit
  area.
- On steps with a layer view, the caption panel carries a **"How was this
  control built?"** button.
- Keyboard: Left/Right arrows are Back/Next and Esc closes, **only while
  focus is in the caption panel or bar, or on nothing**. With focus on the
  copy, arrows and Esc belong to the copy (a knob turns on arrows and relocks
  on Esc). Focus moves to the caption on each step and returns to the "?" on
  exit. The caption is a polite live region.
- **Length caps** (alex's rule against verbose UX notes): a caption aims
  for one line and is at most two short sentences (160 characters); a layer
  paragraph is at most three sentences (280 characters). A unit test holds
  both.
- **Placement**: the caption panel goes on the side of the cut-out with more
  room, and flips when the cut-out moves past the middle. Neither it nor the
  bottom bar may overlap the cut-out; where the cut-out is too tall for both
  (a phone in portrait), the panel docks just above the bottom bar and the
  cut-out is scrolled to sit above it.
- **Reuse and values** (`docs/control-inventory.md`, `docs/design-extract/`):

  | Part | Built from | Values |
  |---|---|---|
  | "?" | the `.dashboard-config-link` box the cog uses, with a lucide `CircleHelp` | its existing 44px box, border and type |
  | Back, Next, Replay, "How was this control built?", Back to the control | `MomentaryFeedbackButton` in the `.dashboard-config-link` treatment | 48px min height; `--cyber-mono`, 0.86rem, weight 900 |
  | Close box | `MomentaryFeedbackButton`, lucide `X` | 32px visible, 44px hit area |
  | Caption panel and bar | the cyber panel surface (`--cyber-panel` background, `--cyber-border-dim` border, clipped corner) | opaque, so its contrast never depends on the mask |
  | Mask | — | black 85% (light), white 75% (dark): **alex's values, 2026-11-16**, not from the extract |
  | Easing | motion tokens | `lg` 450ms for the cut-out, `md` 300ms for a tap, `xl` 1.2s rest between loops |
  | Finger | — | **no extract value**: closest fit is the text token at 70% with a `--cyber-border-dim` press ring; recorded here as a departure |
  | Layer tags | the theme accent and the alert, cool and fan mode colours already in `temperatureEncoderModel.ts` | four distinct colours, no new ones |

  The white mask is checked on a dark theme in a render; if it reads as glare
  on the wall panel at night the value is alex's to change.

## "How was this control built?"

Offered on the light knob steps, the aircon steps, the orb step and the
background step.

- It opens a full-viewport stage over the tour. The control's layers are
  **fanned apart in 3D like a stack of cards**: tilted back about 55° and
  rotated about 35°, each layer lifted further along the stack's axis, with a
  1s ease out of the flat stack on open. Dragging on the stage turns it.
- Every card shows **one layer**, labelled with its name and a tag: **CSS**,
  **SVG**, **Canvas 2D** or **WebGL**, each tag in its own colour from the
  design extract.
- **Previews are pre-rendered to a canvas for this view.** On open, each
  layer is rasterised once into its own 2D canvas: CSS and SVG layers are
  isolated (only that layer visible) and drawn through an SVG
  `foreignObject` or serialised SVG. The orb's Canvas 2D body is copied from
  its own canvas **live** while the view is open, so that card keeps moving.
  The background's WebGL cards are stills (below), to keep GPU cost off the
  kiosks.
- **Tap a card** (or hover it, with a mouse) to raise it and show its
  paragraph: what the layer does and why that method was chosen
  (performance, appearance, a platform limit). Tap is the primary path. The
  paragraph sits in a fixed panel beside the stack in landscape and under it
  in portrait, never clipped by the viewport.
- On a phone in portrait the stack runs vertically with a tighter lift; when
  the cards still do not fit, the stage scrolls.
- A close box and Esc return to **the same tour step**.

### Layer sets

**Rotary knob** (`RotaryEncoder`), bottom to top:

| Layer | Method | Why |
|---|---|---|
| Outer bevel | CSS | Gradients and shadows on one element; scales with `--re-size`; no redraw cost. |
| Glow | CSS (blurred paint) | A blurred conic paint through the ring's annulus; the compositor blurs it once. |
| Colour ring and shade | CSS | A conic-gradient background with a mask; the paint changes with one custom property. |
| Inner bevel | CSS | Same as the outer bevel. |
| Unlock ring: glass, lit, specular | CSS | Three masked layers so the lit colour fades in over 450ms without repainting the glass. |
| Knob face | CSS | Radial gradients; the light/dark skins are one class. |
| Rotor and index line | CSS | Rotated by a transform, which the compositor does without layout or paint. |
| Specular | CSS | A fixed highlight that does not rotate, so the light source stays put. |
| Face text and LEDs | CSS/DOM | Real text, so it stays sharp, selectable to screen readers, and is measured to fit. |
| Rings, thumbs, labels | SVG | Arcs and text on a path need exact geometry; SVG gives curved labels and hit areas per ring. |
| Title arc | SVG | Text on a path over the knob. |

**Status orb**, bottom to top:

| Layer | Method | Why |
|---|---|---|
| Voice glow | CSS | A radial gradient that fades in; nothing to draw per frame. |
| Glass disc | CSS backdrop-filter + SVG lens filter | Refracts the real page behind it. Chromium uses the SVG filter through `backdrop-filter: url()`; WebKit gets a copy of the backdrop through the same filter. |
| Orb body | Canvas 2D | Animated rings, fields and load easing at 60fps; one canvas redraw is cheaper than hundreds of DOM nodes. |
| Reflection and gloss | CSS | Blend-mode layers; the reflection drifts with a transform. |
| Dial indicator | SVG | The stack ring is exact arcs. |
| Counter | DOM text | Sharp at any scale. |

**Background**, bottom to top:

| Layer | Method | Why |
|---|---|---|
| Theme colour | CSS | The flat base, and all that remains with the background off. |
| Fluid field: base | WebGL | One full-screen fragment shader is the cheapest way to draw a moving full-screen field; the GPU does it, not the main thread. |
| Fluid field: peaks and warp | WebGL | The bright moving peaks, warped by noise. |
| Fluid field: hue spread | WebGL | The colour drift across the peaks. |
| Fluid field: apex glow | WebGL | The highlight at each peak. |
| Fluid field: mosaic texture | WebGL | The tiled texture, scaled to the device pixel ratio so it looks the same everywhere. |
| Shell grid and scanlines | CSS | Repeating gradients; free to draw, and they turn off with the background. |
| Header fade strip | CSS | A gradient that keeps the corner buttons readable. |

The five fluid cards are rendered by running **the same shader** with the
other terms switched off through its existing uniforms (peak intensity, warp,
hue spread, apex glow, texture), so each card is the real shader, not a
picture of one. **One offscreen WebGL context, used once**: each term is
drawn in turn, copied to its card's 2D canvas, and the context is then
released with `WEBGL_lose_context` and dropped. Chromium caps live contexts
per page and drops the oldest, which once left the real background blank
(`specs/wallpaper-background-mode.md`, "WebGL lifecycle"); a test opens and
closes the view and checks the live background's context survives. If the
wallpaper replaces the fluid background, the background set is the wallpaper
(CSS image) plus the CSS layers above it.

### The catalogue does not drift

The layer lists above live in one catalogue, keyed by each layer's selector
in the real component. A unit test mounts `RotaryEncoder` and the orb stack
and fails when a catalogue selector no longer matches, or when the dial
gains an `aria-hidden` layer the catalogue does not name, so a change to the
control's internals has to update the catalogue in the same PR.

## Every orientation and device

- Landscape and portrait layouts (`specs/landscape-layout.md`,
  `specs/portrait-layout.md`); phone, tablet, the wall kiosks and desktop;
  touch and mouse.
- Everything is positioned from the control's live rect and the viewport, never
  from fixed coordinates. A resize or a rotation re-measures at once. Kiosk
  display rotation is done by the OS (`ops/kiosk/nova-kiosk-rotate.py`), not
  by a CSS transform, so a control's client rect and the finger's
  coordinates share one space in every rotation; the rendered checks include
  a rotated (portrait) kiosk size, with the "?" checked in its corner.
- Safe-area insets are respected by the bottom bar and the close box.
- The layer stage scales to fit the shorter viewport side; under 600px wide
  the stack and its paragraph stack vertically.
- Rich and Lite modes both run the tour, with the orb and background steps
  skipped where those features are off (above).

## Where the code lives

`app/components/tutorial/`, one concern per file, every file under the 10 KB
cap (`specs/agent-token-footprint.md`): the step table, the mask and cut-out
geometry (pure, tested), the finger driver, the sandbox copies, the caption
panel and bar, the layer catalogue (pure, tested), the rasteriser and the
layer stage. Styles in `app/styles/tutorial/`.

## Delivery

Two PRs, each with its own review, base merge, merge and live force-update:

- **PR 1, the tour**: this spec; the "?"; the mask, cut-out and input guard;
  the finger driver; the caption panel and bar; the sandbox copies; the
  guarded pointer capture and the sound/haptic suppression flag; tests;
  `VOCABULARY.md`, `docs/control-inventory.md` and `specs/README.md`. The
  edits to shared controls are kept to the minimum and listed first in the
  PR description, and a before/after render of the real rotary and orb with
  the tour closed is part of its checks.
- **PR 2, the layer view**: the catalogue and its mount test, the
  rasteriser, the 3D stage, the paragraphs; orb first, then rotary, then the
  background with its single offscreen context. The "How was this control
  built?" button arrives with it.

## Done means

- The tour runs end to end on the demo build and on the live dashboard, in
  landscape and portrait, at phone (390×844), tablet (1024×1366 and
  1366×1024) and kiosk sizes, light and dark, checked on screenshots.
- No Home Assistant command is issued during the tour (unit test).
- Unit tests: the step model, the cut-out geometry, the caption placement,
  the layer catalogue.
- e2e: open from "?", Next/Back, Esc and the close box, scrolling with the
  mask up, the layer view opening and closing.
