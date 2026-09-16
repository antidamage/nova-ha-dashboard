# Status orb priority stack, timer and washing ETA

Plan identifier: `make-the-status-orb-silly-micali`. This random codename does not
request a silly appearance: preserve the existing orb style.

## Status Orb Modules

The Status Orb's entire visual draw stack is data-driven. A "status orb
module" is a small, hand-editable JSON document that declares the orb's
layers — their count, shapes, sizes, proportions, draw order, colors, blend
modes, and animation parameters. The web dashboard renders modules with
canvas 2D today; the Apple TV dashboard implements the same interpretation
with Core Graphics (implementation to follow — the contract below is
shared). New orb looks are published by dropping a JSON file onto the host
with no app update on either platform. The priority stack elsewhere in this
document chooses which module's entry is on show; this section is the
format each entry's module follows.

### Module sources and precedence

- Built-in modules are compiled into the app in `lib/orb-modules.ts`:
  `classic` (Classic Glass — the faithful data-driven port of the original
  hand-coded orb), `reactor` (Reactor Core), `halo` (Halo), and `cross`
  (Cross — a flat diamond-framed X sigil whose activity display is status
  lines riding the X's bars). Built-ins guarantee the orb renders offline
  and before any fetch completes.
- Hot-droppable modules live as `*.json` files in `config/orb-modules/`
  (override the directory with the `NOVA_ORB_MODULES_DIR` env var). The
  shipped example is `aurora.json`; `config/orb-modules/README.md` documents
  the format for editors.
- `GET /api/orb-modules` returns built-ins overlaid with disk modules,
  merged by id. A disk file whose id matches a built-in replaces it, which is
  how a deployed host patches a built-in look in place.
- Invalid disk files are skipped and reported in the response's `errors`
  array (`{ file, error }`); they never break the module list or the orb.

### Theme linkage

- Each theme variant's `avatar.orbModule` field names the module that variant
  renders with, so dark and light themes can use different orb styles. The
  field defaults to `classic`, travels with theme import/export and the theme
  library like every other avatar field, and is normalized to `classic` when
  malformed. Well-formed but unknown ids are preserved (the module may exist
  on the host before a client has fetched it) and render as `classic` until
  they resolve.
- Modules define geometry and animation; the theme defines color. Every
  module references the same theme color slots, so switching modules never
  requires re-picking colors.

### Module document format (`formatVersion` 1)

- Top-level fields: `formatVersion`, `id` (url/file-safe slug, ≤ 64 chars),
  `name` (picker label), `description` (picker detail line),
  `alertPulsePeriod` (seconds per gym-alert pulse cycle, default 1.2), and
  `layers` (ordered array, first layer at the bottom).
- Documents with a newer `formatVersion` than the renderer understands are
  rejected whole; unknown layer types inside a supported version are skipped
  individually (forward compatibility). A module with a bad id or no usable
  layers is rejected and the renderer falls back to `classic`.
- All normalization lives in `lib/orb-modules.ts` (`normalizeOrbModule`) and
  is applied by the server route, the web client, and the tests; clients
  re-normalize defensively after fetch.

### Coordinate and angle conventions (the cross-platform contract)

- Unit space: orb radius = 1.0, orb center = (0, 0), +x right, +y down.
  Every length is a fraction of the orb radius, so a module renders
  identically at any pixel size. On the web the orb radius maps to
  `size * 0.48` of the avatar canvas, leaving margin for glow spill.
- Angles and sweeps are in turns (0..1 per revolution, clockwise from
  3 o'clock); angular speeds are turns/second. Renderers convert to native
  radians at draw time.

### Color references

- A layer color is `{ "theme": <slot> }` or `{ "hex": "#rgb|#rrggbb" }`
  (theme wins if both appear; invalid refs degrade to opaque white), plus
  optional `alpha` (0..1 multiplier) and optional `alertTheme` (a slot the
  resolved color mixes toward by the alert pulse while the gym alert is
  active — this is how the classic background throbs toward the alert color
  with zero module-specific renderer code).
- Theme slots: `gradientCenter`, `gradientOuter`, `gradientAlert`, `line1`,
  `line2`, `line3`, `gymNumber`, `innerShadow`. The host resolves slots into
  a per-frame palette (`buildOrbPalette`): line slots carry their per-line
  0-100 theme opacities as alpha, `gymNumber` carries its theme opacity, and
  `innerShadow` resolves to black at the theme's `innerShadowOpacity`.

### Blend modes

- `normal`, `additive`, `screen`, `multiply` — chosen because they map 1:1
  onto both canvas composite operations (`source-over`, `lighter`, `screen`,
  `multiply`) and tvOS `CGBlendMode` (`.normal`, `.plusLighter`, `.screen`,
  `.multiply`), so neither platform emulates blending.

### Fields shared by every layer

- `id` (optional editor label), `enabled` (default true), `blend` (default
  `normal`), `opacity` (0..1 layer multiplier), `clip` (confine the layer to
  the orb's unit disc so gradients/glows cannot spill past the rim), `glow`
  (soft glow radius as a fraction of the orb radius, drawn in the layer's own
  color), and `pulse` (`{ period, min, max, alertOnly? }` — multiplies layer
  opacity by a raised-cosine wave; with `alertOnly` the layer is hidden
  entirely until the gym alert activates, the building block for alert-flash
  layers).

### Layer types

- `disc`: filled circle/ellipse with a radial gradient. Fields: `center`,
  `radius`, `scaleY` (ellipse), `rotation` (turns), `stops`
  (`[{ at, color }]`; one stop = solid fill), and optional `gradientFrom` /
  `gradientTo` focus circles (`{ x, y, radius }`) for offset gradients —
  vignettes and "lit from above" falloffs. The gradient stays circular in
  unit space even for elliptical discs, matching the original cap highlight.
- `ring`: stroked full circle. Fields: `radius`, `width`, `color`.
- `arc`: stroked partial arc whose stroke is a linear gradient laid from the
  arc's start endpoint to its end endpoint so brightness tapers along the
  sweep. Fields: `radius`, `width`, `from`, `to`, `cap` (`round`/`butt`),
  `reverse` (flip the gradient direction), `stops`.
- `arcField`: the animated, load-reactive segment swarm. Fields: `count`,
  `radiusMin`/`radiusMax` (the radial band), `distribution` (`spread` =
  even spread with jitter, `rings` = snapped to `ringCount` concentric
  rings), `ringJitter`, `widthMin`/`widthMax`, `colors` (assigned per
  `colorMode`; defaults to the three line slots), `colorMode` (`cycle` =
  round-robin, the default; `random` = each segment picks a random entry at
  creation), `cap`, `idleSweepMin`/`idleSweepMax` (sweep range at zero
  load), `loadSweep` (sweep at full load), `speedMin`/`speedMax` (base
  angular speed range), `loadSpeed` (extra speed at full load),
  `sweepEase`/`velocityEase` (per-second easing rates),
  `resampleMin`/`resampleJitter` (seconds between target resamples).
- `line`: a single stroked straight segment. Fields: `from`/`to` (unit-space
  endpoints), `width`, `color`, `cap`. The building block for cross/sigil
  geometry such as the bars of an X.
- `polygon`: a stroked or filled polygon/polyline from explicit unit-space
  `points` (at least three; two-point shapes belong to `line`). Fields:
  `points`, `color`, `fill` (filled when true, otherwise stroked with
  `width`), `close` (set false for an open polyline, default true). Used for
  diamond frames, corner accents, and other straight-edged chrome.
- `lineField`: the linear counterpart to `arcField` — animated stroked
  segments riding back and forth along straight tracks. Fields: `count`,
  `tracks` (`[{ from, to }]` unit-space paths; segments are assigned
  round-robin, so two tracks split the population in half),
  `widthMin`/`widthMax`, `colors`/`colorMode` (as in arcField), `cap`,
  `idleLengthMin`/`idleLengthMax` (segment length range at zero load, as
  fractions of the track length), `loadLength` (length at full load),
  `speedMin`/`speedMax` (base travel speed range, track-lengths/second),
  `loadSpeed` (extra speed at full load), `lengthEase`/`velocityEase`,
  `resampleMin`/`resampleJitter`.

### arcField motion model (identical on both platforms)

- Each segment keeps an angle, sweep, angular velocity, and a resample
  deadline. When the deadline passes, new targets are sampled: sweep =
  random idle sweep stretched toward `loadSweep` by the current load; speed =
  random base speed plus `load * loadSpeed`, with random direction. Sweep and
  velocity ease toward their targets each frame and the angle integrates the
  velocity. Segments are created with zeroed targets and an immediate
  resample so the first frame populates real targets.
- Segment radius, stroke width, and color assignment (per `colorMode`) are
  sampled once at renderer creation; switching modules rebuilds the renderer
  and restarts the animation, while theme color edits flow through the
  per-frame palette without touching animation state.

### lineField motion model (identical on both platforms)

- Each segment keeps a track assignment, a center position `pos` (0..1 along
  the track), a length, a signed velocity (track-lengths/second), and a
  resample deadline. Resampling mirrors arcField: length = random idle
  length stretched toward `loadLength` by the current load; velocity =
  random base speed plus `load * loadSpeed` in a random direction (the
  "randomly reverse along the path" behavior). Length and velocity ease
  toward their targets each frame — all movement is lerped — and the
  position integrates the velocity.
- The segment spans `[pos - length/2, pos + length/2]` and must stay inside
  `[0, 1]`: hitting a track end reflects both the live and target velocity
  (a bounce), and a segment that outgrows its track pins centered. Initial
  positions are random so co-track segments are desynced from the start.
- Segments are distributed round-robin across `tracks` — the cross module
  uses two tracks along the X's bars, so half its status lines travel the
  top-left/bottom-right diagonal and half the top-right/bottom-left one.

### Web implementation

- `lib/orb-modules.ts`: types, normalization, color resolution
  (`resolveOrbColor`), built-in module definitions, and the
  `resolveOrbModule` fallback rule (requested id → fetched map → built-ins →
  `classic`). Shared by server and client; no React/DOM/fs imports.
- `lib/orb-modules-disk.ts`: server-only loader for the hot-drop directory.
- `app/api/orb-modules/route.ts`: the merge-and-serve route (no-store).
- `app/components/orbModules.ts`: client cache + `useOrbModules()` /
  `useOrbModule(id)` hooks (built-ins synchronously, host refresh on mount
  and every 5 minutes, fan-out via a window event) and `buildOrbPalette`.
- `app/components/orbRenderer.ts`: the canvas interpreter
  (`createOrbRenderer(module).render(ctx, frame)`); the frame carries center,
  radius in px, palette, load, alert state, and timing. The caller clears the
  canvas; the renderer isolates every layer in save/restore.
- `NovaAvatar` owns the canvas, the load polling/easing, and the per-frame
  palette; all drawing is delegated to the active module's renderer. The
  readout is delegated too — `useOrbInfo` owns the selected info module, its
  sources and its formatting, and hands back the text, alert state and aria
  label.
- `GET/POST /api/orb-info` reads and updates the `orbInfo` preference. A POST
  force-publishes dashboard state, because the Apple TV takes its readout
  configuration from that payload rather than calling this endpoint.

### Apple TV implementation (`nova-appletv-dashboard/.../OrbModules.swift`)

- The tvOS client fetches `GET /api/orb-modules` from the dashboard host on
  its own 5-minute poll, decodes the same document shape leniently (clamped
  values, unknown layer types skipped, invalid documents rejected whole, a
  lossy module list so one bad host module never sinks the catalog), and
  merges the response over the compiled-in built-ins so a partial response
  can never remove the offline fallbacks.
- The built-ins are embedded as the exact JSON exported from
  `lib/orb-modules.ts` (`BUILTIN_ORB_MODULES`) and decoded through the same
  path as fetched modules, so both platforms agree on the documents
  byte-for-byte. Regenerate the embedded JSON when the web built-ins change
  (the regeneration command is commented next to the constant in
  OrbModules.swift).
- The shared theme decode carries `avatar.orbModule` into
  `DashboardAvatarTheme` with the same id validation and `classic` fallback;
  `DashboardStore.orbModule(id:)` applies the shared resolve rule
  (fetched map → built-ins → classic).
- `NovaAvatarOrb` delegates all drawing to the module interpreter
  (`drawOrbModule`) inside its SwiftUI `Canvas`: unit space maps onto the
  orb frame (radius = 0.48 × the view edge, matching the web convention),
  turns convert to radians at draw time, the four blend modes map onto
  `GraphicsContext` blend modes (`.normal`/`.plusLighter`/`.screen`/
  `.multiply`), `glow` renders as a shadow filter in the drawn color, and
  `clip` confines layers to the orb disc. The gym counter overlay, load
  polling, and listening load boost stay native.
- arcField/lineField animation state lives in `OrbAnimationModel` with the
  identical motion model (turns/track-fraction state, randomized resamples
  scaled by load, eased sweep/velocity, lineField end-bounce reflecting both
  live and target velocity); state rebuilds when the module value changes
  and is untouched by theme color edits.
- One documented approximation: SwiftUI `GraphicsContext` radial gradients
  are concentric, so a disc's offset focal gradients (`gradientFrom`/
  `gradientTo` with different centers, e.g. the classic bottom vignette)
  render centered on the from-circle — the same approximation the previous
  hand-coded tvOS orb used, visually indistinguishable at orb sizes.

## Requirements

**Priority stack**
- Preference becomes an ordered list of entries; each entry = module id + display + params + activation. Highest *active* entry wins; one entry shows at a time.
- Activation: `always` (gym, clock, CPU…) or `whenAlerting` — **any existing module** can be set to only take the orb while its alert is true. An `always` entry blocks everything below it.
- Event entries (washing, timer, rain, power, update) are inherently "active only when their condition holds".
- Config editing: rows with drag handles, Add-entry via grouped `ConfigSelect`, remove, each row expands into its existing display/params editor.
- Migration: existing `moduleId` becomes a one-entry list.

**Orb rendering of event entries**
- Icon + text (remaining time). Timer additionally draws a countdown ring around the icon.
- Ring: alert colour; starts full at 12 o'clock and depletes **counter-clockwise** — nearly full = arc from 12 clockwise round to 11; last remaining arc = 12→1.
- On completion: ring vanishes, icon remains, orb alert-flashes until tapped.
- While any tap-to-dismiss alert (timer or wash) is showing, an orb tap **dismisses** it everywhere and does not start push-to-talk.

**Washing entry**
- Active while a wash claimed by the **primary user** is running, and after it completes until acknowledged.
- Config: `dashboard.people` gains a `primary` flag (exactly one); the dashboard serves that user. Wash heuristics are the primary user's (`autoAttribution`).
- ETA: count down to the primary's typical wash duration (new config `typicalMinutes`, Adeline 66). Once exceeded, show elapsed overrun counting up (e.g. `+0:07`) — no re-guess.
- On completion: orb flashes; orb tap acknowledges the wash (same effect as acknowledging its reminder).
- **If the stack contains a washing entry, the temporary wash reminder icon is not displayed.** Existing wash sound choice and Discord message stay; orb-backed sound repeats as specified below.

**Timer**
- One timer, server-side household state: every screen's orb and set-timer control show the same countdown; completion handled server-side so Discord fires with no screen open.
- Timer holds its own position in the priority list (`timer` entry).
- Range: logarithmic ring, 1 min → 8 h. Steps: 1-min to 10 min, then coarser even divisions switching at major points (proposal to record: 5 min to 60, 10 min to 2 h, 15 min to 4 h, 30 min to 8 h). Below 1 min = Off. Ring value tap opens `NumericEntryPopover` for exact entry.
- Icon list is **user-defined** in config (pick + order glyphs via `ReminderIconPicker`).
- Completion: sound plays **every 30 s for 5 min, then silent**, orb still in alert mode. Tapping the orb on any device dismisses it everywhere (sound stops everywhere).
- Sound chosen in the **theme** from a dropdown. Preload: the six MP3s in `D:\Downloads\Windows Sounds\` (Chime, Magical, Motion tracker, Retro boop, Soft boop, Tink) — ignore the WAVs.
- Discord on completion: names the icon's timer type and the duration, e.g. "Egg timer finished — 6 min".
- Dragging the timer ring to zero cancels: removed from orb, **no** sound, **no** Discord.

**Set-timer control (RotaryEncoder variant, `TimerEncoder`)**
- Location: System → Reminders sub-panel, **above** the reminder lists. Today/Upcoming lists move into that panel's `AdvancedFold` advanced area. Nothing else from reminders goes on the orb.
- Flow: tap to activate (unlock) → drag knob to step through icons (selected icon in the centre) → drag the outer timer slider ring past Off → de-focus (or idle timeout) starts it. Any non-zero value starts on de-focus.
- While running: control is locked and counts down itself — remaining time on the face and the same counter-clockwise alert-colour ring around its icon.
- Tap the control (not the orb) to unlock and show the timer ring again for adjusting/cancelling.
- Apple TV: displays the stack incl. timer/wash; **no timer setting on Apple TV** yet.

**New event entries** (params with these defaults)
- Rain arriving: active when rain chance ≥ 50 % within next 60 min (hourly forecast); umbrella icon + minutes until rain.
- High power draw: active above 3.0 kW sustained 2 min; bolt icon + kW.
- Nova update running: active while a self-update (`/api/update`) is in progress; spinner icon.
- Visitor at the door: **shelved** (needs new hardware).


## Resolved completion behaviour

Owner clarification, 2026-09-14: washing and timers use the same behaviour.
When the corresponding entry is configured in the orb stack, chime every 30
seconds for five minutes, then remain silently alerting until an orb tap
acknowledges the occurrence on every screen. Suppress that occurrence's temporary
reminder icon. If no corresponding orb entry is selected, show the temporary
task icon and chime once. A higher-priority entry temporarily hiding an event
does not mean the event is unconfigured. Cancellation is always silent.

The other plan proposals are the implementation defaults: minute divisions
1 to 10, 5 to 60, 10 to 120, 15 to 240, 30 to 480; five-second idle start;
update-running covers in-app self-update only.

## Acceptance

Highest active row wins on web screens and Apple TV. Reordering and editing
preserve sibling entries, including duplicate modules; legacy moduleId settings
migrate to one row. Timer set, adjust, silent cancel, countdown, completion,
shared dismissal and server-side Discord delivery all work. Full ring begins
at twelve, remaining arc runs clockwise from twelve, and its endpoint recedes
counter-clockwise; completed rings disappear. Primary-user wash ETA becomes
an elapsed overrun after the configured typical duration without re-guessing.
Orb taps dismiss displayed completion alerts before push-to-talk. Apple TV
supports display and dismissal, with no timer-setting UI.

Verify pure stack/preferences, timer lifecycle and logarithmic-step functions;
exercise two browser tabs, persisted configuration, sound expiry, server-only
completion and Apple TV display. Deploy dashboard, Discord module and Apple TV
in that order, subject to the shared deployment-chain coordination.

## Round 2 (Adeline, 2026-09-15)

Plan `we-ve-separated-the-landscape-s-ancient-parnas` round 2, task log
`20260914T101019Z-06c0031b`. Supersedes "Highest active row wins", the
`always` / `whenAlerting` activation, and orb push-to-talk.

### Entry kinds and states

- **Countdowns** are `timer`, `washing` (ETA / overrun) and `rain-arriving`
  (minutes until rain). They are interchangeable: among running countdowns, the
  **shortest remaining** shows first. A washing overrun (`+0:07`) counts as zero
  remaining. A countdown's row position in config does not order it.
- Every other entry is **non-countdown** and has a state evaluated each tick:
  - `off`: not in the stack at all.
  - `on`: in the stack, in the user's arranged order.
  - `alert`: raised to the top.
- The entry's config holds `enabled` (user switch). A disabled entry is always
  `off`. An enabled entry is `on` unless its module says otherwise:
  - **Gym**: `off` until 24 h since the last session (`showAfterHours`, default
    24), `on` from then, `alert` from its configured alert threshold.
  - Modules with an alert condition: `alert` while it holds, else `on`.
  - Modules without one: `on`.
- A countdown whose condition has completed (finished timer, completed wash) is
  an alerting entry, not a countdown.

### Order

1. Alerting entries (finished timer, wash done, due reminder, any module in
   `alert`); among themselves, most recent alert first.
2. Running countdowns, shortest remaining first.
3. `on` entries, in the user's arranged order.

The first entry is what the orb shows at rest. The config page keeps the
drag-to-arrange list; each non-countdown row gets an enabled switch; countdown
rows are marked as countdowns and are not ordered.

Legacy migration: `activation: "always"` becomes enabled; `whenAlerting`
becomes enabled with `showOnlyWhenAlerting: true` (never `on`, only `alert`).

### The dial

- **Orb push-to-talk is removed.** Wake word and other voice entry points stay.
- A single tap on the orb, when the entry on show is not alerting, opens the
  **dial**, and dragging around the orb steps through the stack. Turning toward
  the low end reaches the top entry; toward the high end, the lowest-priority
  entry. One detent per entry.
- Content changes **slide** between entries in the turn direction (about 220 ms,
  ease-out), clipped to the orb face with a soft opacity fade at the edges (a
  mask, no hard edge).
- Keyboard: Enter/Space opens the dial; arrow keys step; Escape closes.
- Apple TV shows the same ordering (display only, no dial).

#### The dial is the RotaryEncoder indicator

Adeline, 2026-09-16 (plan `piped-wondering-mountain`): "the tap-and-dial
function for the status orb ... should just be the existing dial indicator and
lines that appear when we enable a temperature dial, following the same display
rules."

- The orb no longer draws its own ring and position mark. It renders the
  **`RotaryEncoder` indicator layer** — the sunken ring and the index line — in
  the accent colour, exactly as the temperature dial does, and
  inherits `specs/color-encoder.md`'s tuck-away rules verbatim: a tap of
  60–400 ms with under 5 px travel unlocks; the indicator re-locks after 5 s
  idle; a pointer-down outside locks it at once; Escape locks; Enter/Space
  unlocks. The orb's own `ORB_DIAL_DEFOCUS_MS` timing is the same 5 s, so the
  visible behaviour of the timeout does not change.
- **No LEDs on the orb** (Adeline, 2026-09-16). The knob's lights are not
  carried over: the orb face is a readout, and the lights sat on top of it. The
  index line alone marks the entry on show, its angle taken from the entry's
  position in the stack.
- **De-focusing reverts to the preferred display order immediately.** The
  separate 10-second `ORB_DIAL_RETURN_MS` linger is removed: when the dial
  locks, the orb slides straight back to the top of the order computed by
  `orderOrbStack`, with the same 220 ms animation.

#### The dial never drags the page

Adeline, 2026-09-16: "when rotating this dial, it should not drag the page
around. page scrolling should not be possible if the first tap was in the status
orb."

- **Any press that starts anywhere on the orb blocks page panning**, whether or
  not the dial is unlocked, and for the whole gesture.
- The mechanism is the one `RotaryEncoder` already uses: the orb host is marked
  non-draggable so `useClickDragScroll`'s `startsInNonDraggable` refuses to arm
  a page pan (`role="slider"` / `data-nova-no-drag-scroll`). `touch-action:
  none` alone is not enough — it stops native touch scrolling but leaves the
  mouse drag-pan armed, which is why the orb dragged the page before this.

### Tapping an alert

- A tap on the orb while the entry on show is **alerting** dismisses that
  occurrence **on every screen**, with the dial open or not: a finished timer, a
  completed wash, and **due reminders** (same effect as acknowledging the
  reminder's tile or alert). It never opens the dial.
- Dismissal is server-side and broadcast on the dashboard event stream; every
  open screen drops the alert and stops its sound on the next event delivery.
  Reported 2026-09-15: a dismissal had to be repeated on several devices. That
  is the defect to fix.

### Gym display

- The gym entry shows a **weights icon** (Phosphor `Barbell`) above its value,
  laid out like the timer entry: icon above, text below, text scaled down to fit
  the face at the sizes the timer uses.

### Done means (round 2)

- Unit tests for ordering: alert beats countdown beats on; two countdowns order
  by remaining; off never appears; gym off/on/alert at 23 h / 24 h / threshold.
- Orb tap opens the dial; dragging steps entries; 5 s defocus; animated return
  to the top after 10 s.
- A tap on a finished timer, completed wash or due reminder dismisses it in two
  open browser contexts at once.
- Gym shows the barbell icon with fitted text.
- Apple TV conformance cases updated for the new ordering.

## Round 3: the gym alert sinks (Adeline, 2026-09-16)

The gym alert is the exception to alert priority: it goes **at the bottom of
the stack, always**, below running countdowns and below plain `on` entries. A
running timer sits above it, as does everything else. The justification is that
a gym alert is typically a week old and clearing it needs physical work, so it
is never the most useful thing on the orb at the moment it fires.

- Ordering becomes: other alerts (most recent first) → countdowns (shortest
  remaining first) → `on` entries in user order → **gym alerts** (most recent of
  them first, when more than one gym module is on the stack).
- Applies to both gym modules, `gym` and `gym-progress`
  (`ORB_SINKING_ALERT_MODULE_IDS` in `lib/orb-info/stack.ts`, mirrored by
  `OrbStackOrdering.sinkingAlertModuleIDs` on Apple TV).
- A sunk gym alert still alerts: it keeps its alert colour and pulse on the dial,
  it just no longer takes the orb's resting slot from anything else.
- Done means: the shared case table in `lib/orb-info/stack-cases.json` covers a
  gym alert ordering below a countdown and a plain `on` row, and two gym alerts
  ordering among themselves; both the web tests and the Apple TV parity self
  tests run it.
