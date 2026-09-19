# Experience modes: rich and lite

Older tablets cannot afford the dashboard's full visual load, so every device
tunes four independent heavy features: the **status orb**, the WebGL **fluid
background**, the live **camera** video, and the live maplibre **world map**
with radar. Each can be on or off per device. **Full Experience** turns all
four on (plus every CSS effect); **Lite** turns all four off and engages the
global CSS kill-switch for maximum performance; any mix in between is allowed.
See the Experience Mode Parity rule in §2: every new visual/costly feature
must declare its lite behavior.

### Storage model

- Per-device localStorage key `nova.dashboard.experienceMode.v1`, owned by
  `app/components/dashboard/experienceModeSetting.ts`
  (`readStoredExperienceFeatures`, `readExperienceFeatures`,
  `writeExperienceFeatures`, `setExperienceFeature`, `useExperienceFeatures`,
  `useExperienceFeature`, plus the legacy coarse helpers
  `readStoredExperienceMode`, `readExperienceModeSetting`,
  `writeExperienceModeSetting`, `useExperienceMode`, `useLiteMode`). Like auto
  fullscreen, it never travels with a theme and is never written to shared
  config.
- The stored value is backward-compatible: `"rich"` (all four on) and `"lite"`
  (all four off) are the canonical extremes and are still what the modal and
  seed helpers write; a mixed state serialises as a JSON
  `{statusOrb,background,camera,worldMap}` object. Missing object keys default
  to on.
- An absent or invalid key means the device is **undecided**: rendering
  resolves to all-on/rich (matching SSR) and the first-run chooser is shown.
- Writes toggle `data-nova-lite` (all four off) and `data-nova-no-orb` (status
  orb off) on `<html>` and dispatch the `nova-experience-mode-change`
  CustomEvent; hook instances also listen to native `storage` events for
  cross-tab sync.
- The head bootstrap in `app/layout.tsx` mirrors the key pre-paint, setting
  `data-nova-lite` and `data-nova-no-orb` before first paint so the CSS
  kill-switch and orb suppression apply from the first frame. The legacy
  `nova.dashboard.hideStatusOrb.v1` key is retired and deliberately ignored
  (product decision: every device is asked once instead of migrating).

### First-run chooser

- `app/components/ExperienceModeModal.tsx`, mounted in the root layout body so
  it covers every route. It renders nothing on the server and on the first
  client render; an effect reads the stored mode and reveals the dialog only
  when undecided (satisfying the §2 hydration rule, and guaranteeing decided
  devices never see a flash of it).
- Portal to `document.body` reusing the `system-confirm-*` styling;
  `role="alertdialog"`, focus moved to the primary button. There is **no**
  outside-click dismiss and no close button — a choice is required, otherwise
  "ask once" cannot be honoured. Buttons: "Lite" and "Full Experience"
  (primary). A hint line points at Config → This Device for changing it later.

### Config surface

- The `/config` "This Device" section (§21) exposes the four features as four
  `CheckboxRow`s: "Show Status Orb", "Show Background", "Show Camera", "Show
  World Map". Each toggles just its feature via `setExperienceFeature`, which
  also settles an undecided device, and applies live — no reload. The
  first-run modal's Lite/Full Experience buttons write all four at once.

### Behavior by feature (when its toggle is off)

- **Status orb** (§22): never mounted; no `/api/nova-load` or gym polling, no
  canvas loop. Pre-paint CSS hides the SSR markup (via `data-nova-lite` when
  fully lite, or `data-nova-no-orb` when only the orb is off). Gated on
  `useExperienceFeature("statusOrb")`.
- **Fluid background**: `Dashboard.tsx` does not mount `FluidBackground`, and
  the shell drops to the **flat theme background colour** — `var(--cyber-bg)`
  and nothing else. The `.dashboard-shell` grid gradients and both decorative
  pseudo-elements (`::before` border rules, `::after` scanlines) are suppressed
  too. Background off means *no background features at all*, not "the shader
  off but the grid still on" (Adeline, 2026-09-19). Implemented by
  `data-nova-no-background` on `<html>`, written by the same pre-paint path
  that already writes `data-nova-no-orb`, so there is no flash of the grid
  before React mounts. Gated on `useExperienceFeature("background")`.
- **World map**: `panel-registry.tsx`'s `WorldMapPanel` renders a static
  "Map Offline" placeholder instead of maplibre — no WebGL map, satellite
  tiles, or radar animation — and `useRadarPreload` skips both the radar tile
  preload interval and the maplibre module preload. Both gated on
  `useExperienceFeature("worldMap")`.
- **Camera**: `OutsideControls` does not mount `CameraPanel` (no hls.js, no
  video decode). Gated on `useExperienceFeature("camera")`.
- **Dot controls**: the remote-easing rAF loops in `DotControls.tsx` are
  skipped when the device is in full lite (all four off, `useLiteMode()`);
  values snap to target.
- **Visualiser controls**: no gate is needed. The panel is markup plus
  `ConfigAccordion`, `ConfigSelect` and the `DotControls` wrappers, so it
  inherits their lite behaviour — its sliders snap and its accordions open
  instantly. It runs no timers, no canvas and no stream of its own; driver lanes
  are evaluated by the renderer, not by the editor.
- **Scrolling**: native/instant on every device. The former smooth-scroll
  feature — the CSS `scroll-behavior: smooth` default plus the JS wheel-momentum
  engine (`useSmoothWheelScroll`) and its per-device "Smooth Scrolling" toggle
  and speed slider — was removed. Page-level jumps (anchor/hash, keys,
  programmatic `scrollTo`) now land instantly, so reload scroll-restore
  (`useScrollRestore.ts`, `ConfigWorkspace.tsx`) no longer needs to fight a
  smooth default.
- **Click-and-drag scroll**: `useClickDragScroll` (mounted via
  `SmoothScrollController`) lets **mouse** users press anywhere and drag to pan
  the window scroll on both the dashboard and `/config`, mirroring the native
  touch drag — touch is left untouched (mouse events only). A 5px movement
  threshold keeps ordinary clicks working (buttons/links still activate; a real
  drag suppresses the trailing click and any native link/image drag). Form
  fields, `[role="slider"]`, contenteditable, the maplibre map, inner scroll
  regions, and `data-nova-no-drag-scroll` opt-outs are skipped. It is a direct
  1:1 input (no easing/animation), so it is not gated by lite or reduced-motion.
- **Reminder icon bar** (§19): renders identically — the tiles, their
  dim/lit opacity, and tap-to-complete are all unaffected. Only the overdue
  glow pulse stops animating, holding its first keyframe (no glow, still full
  opacity, still the alert colour). No gate is needed: the animation is plain
  CSS, and the component adds no timers or streams of its own.
- **Task glow**: the inset blur stacks are flattened via CSS overrides on the
  consuming rules (the `--task-glow-*` vars are inline styles on `<html>`, so
  the vars themselves cannot be overridden from a stylesheet).
- **All CSS animations/transitions/backdrop-filters**: neutralised wholesale
  by the kill-switch below.

### CSS kill-switch contract

- `app/globals.css` carries a `html[data-nova-lite] *` blanket rule setting
  `animation-duration: 0.01ms`, `animation-iteration-count: 1`,
  `transition-duration: 0.01ms`, and `backdrop-filter: none` (all
  `!important`). Near-zero durations — not `animation: none` — so fill-mode
  reveals still complete instantly and land on their end state.
- `.animate-spin` is exempted: busy spinners are functional feedback, not
  decoration.
- `box-shadow` is deliberately not blanket-killed (panel borders depend on
  it); only the task-glow stacks are flattened individually.
- `app/liteMode.contract.test.ts` greps these contracts in source and fails
  with a pointer here if they are refactored away.
