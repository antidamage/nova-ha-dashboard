# Phonoscope Module Authoring Specification

This document is the complete authoring contract for Nova Phonoscope engine
version 1. It is intentionally self-contained: give this file to a coding agent
and ask it to produce a Phonoscope module package. The result must validate with:

```powershell
npm run phonoscope:validate -- path\to\module.yaml
npm run phonoscope:pack -- path\to\module-directory
```

The runtime is a visual simulation, not a general program loader. A module may
contain YAML and PNG/JPEG images only. It may not contain scripts, executable
code, custom Metal source, binaries, SVG, video, audio, or network references.

## 1. Package and identity

A distributable module is a ZIP with this layout:

```text
module.yaml              required
preview.png              optional 16:9 dashboard preview
assets/
  spark.png              optional module texture
```

`module.yaml` begins with:

```yaml
engineVersion: 1
id: unique-lowercase-id
packageName: nz.skull.nova.visualiser.unique-lowercase-id
version: 1.0.0
name: Human Readable Name
description: What the effect does.
dimension: 2d
bounds:
  min: [-1.7778, -1]
  max: [1.7778, 1]
boundary:
  mode: bounce
  restitution: 0.82
```

- `id` is 2–64 lowercase letters, digits, `_`, or `-`, beginning with a letter.
- `version` is semantic `major.minor.patch`. Uploading the same id/version twice
  is rejected; increment it for every published change.
- A module is entirely `2d` or `3d`.
- 2D bounds use `[x,y]`; 3D bounds use `[x,y,z]`.
- In 2D, Z is draw order rather than a physics axis.
- Bounds are world units. The default camera frames them automatically.

Package limits are 25 MB compressed, 100 MB extracted, and 2048×2048 per image.
The active package is compiled and hashed by the dashboard before tvOS sees it.

## 2. Top-level document

```yaml
engineVersion: 1
id: example
version: 1.0.0
name: Example
description: Optional
dimension: 2d
bounds: { min: [-1, -1], max: [1, 1] }
boundary: wrap
settings: []
templates: {}
scene: []
resources:
  maxParticles: 4096
  maxInteractiveFieldEntities: 1024
  maxRenderBatches: 16
metadata:
  author: Name
  license: Household use
  tags: [example]
```

`templates` holds reusable entity definitions. `scene` holds root instances.
An entity can reference a template and override its fields. Template expansion
is declarative inheritance; it cannot create code or mutate the template.

The hard runtime ceilings are:

| Resource | Ceiling |
| --- | ---: |
| Live particles | 65,536 |
| CPU-interactive field entities | 16,384 |
| Render batches | 64 |
| Recursive spawn depth | 4 |
| Trail history | 32 |
| Expression instructions | 64 |
| Propagation hops per effect | 8 |
| Effect deliveries per physics tick | 8,192 |
| CPU simulation budget | 4 ms |

The module may request lower limits in `resources`. Work beyond a limit is
clipped or dropped; it never accumulates into later frames.

## 3. Settings

Settings become typed controls in the web dashboard. Every control still
resolves to a finite numeric value so it can be read uniformly from module
expressions:

### Palette slots

Every module receives the reusable `primary`, `secondary`, `tertiary`,
`background`, `primaryText`, and `secondaryText` slots. A package may declare
additional generic slots for colour groups shared across modules:

```yaml
paletteSlots:
  - id: ambientGlow
    label: Ambient Glow
    defaultRgb: [40, 120, 255]
```

Use slots as `palette.<id>` in colour expressions. Older
`palette.accent`/`palette.highlight` expressions remain aliases for
`primary`/`secondary`, but new modules should use the canonical names.

```yaml
settings:
  - id: intensity
    label: Intensity
    description: Base energy applied to every beat.
    control: slider
    min: 0
    max: 2
    step: 0.05
    default: 1
    curve: { type: power, exponent: 1.6 }
    affects:
      - scene.particle-grid.effectSources.beat-ripple.strength
```

Read the value as `settings.intensity` in an expression. Existing saved values
are clamped to the declaration when a new module version loads.

`control` may be `slider`, `number`, `toggle`, or `select`; omitted control
types remain backward-compatible sliders. Toggles resolve to `0` or `1`.
Select controls declare at least two numeric options:

```yaml
- id: blend_mode
  label: Blend mode
  control: select
  default: 1
  options:
    - { label: Soft, value: 0 }
    - { label: Additive, value: 1 }
```

A slider curve may be `linear` (the default) or `power`. A power curve changes
the physical slider travel without changing the actual value stored or exposed
to the expression runtime; exponents above `1` provide finer control near the
minimum. The exponent range is `0.1` through `8`.

`affects` is declarative control metadata. It lists the module paths the author
has wired to `settings.<id>` and is shown on the configuration page, making the
control's purpose inspectable without giving it executable behavior.

Controls may declare `section: motion` (or another short label). The dashboard
groups controls with the same label in its "add effect" picker; controls without
a section fall into the general group. Do not use `physics` — the panel is
Visualiser controls now, and that word is retired from the user-facing surface.

`updateMode` is `smooth` by default. Smooth numeric settings are interpolated
in the running simulation and must not rebuild the scene. Use
`updateMode: structural` only for values such as grid resolution, topology, or
resource allocation. Structural edits remain pending until the user explicitly
applies them, at which point the visualiser performs one deliberate rebuild.

## 4. Entities and templates

An entity may contain these components:

```yaml
templates:
  mote:
    lifetime: 2
    transform:
      position: [0, 0, 0]
      rotation: [0, 0, 0]
      scale: [0.02, 0.02, 0.02]
    render:
      primitive: sprite
      texture: assets/spark.png
      material: emissive
      color: [0.2, 0.8, 1, 1]
      opacity: 1
      glow: 0.8
      blend: additive
    physics:
      velocity: [0, 0.2, 0]
      mass: 1
      drag: 0.04
      inertia: 0.985
      gravity: [0, -0.1, 0]
    boundary: wrap
    children: []

scene:
  - id: first-mote
    template: mote
    transform:
      position: [0.25, 0, 0]
```

Supported render primitives are:

- `sprite`, `billboard`, `text`, `artwork`
- `point`, `line`, `ribbon`, `trail`, `ring`
- `plane`, `cube`, `sphere`, `cylinder`, `cone`, `torus`, `icosphere`

Supported materials are `unlit`, `phong`, `emissive`, and `wireframe`.
Supported blends are `opaque`, `alpha`, and `additive`. Common render keys are
`color`, `colorStart`, `colorEnd`, `glowColorStart`, `glowColorEnd`,
`trailColorStart`, `trailColorEnd`, `opacity`, `glow`, `lineWidth`, `texture`,
and `depthWrite`. Fields can similarly provide `wireframeColorStart` and
`wireframeColorEnd`.

Start/end colours are shader gradient endpoints, not animation inputs. Primary
palette colours belong at the start, centre, or first vertex; Secondary colours
belong at the end, outer edge, or last vertex. The renderer interpolates them
from local primitive geometry: centre-to-edge for points and glows,
source-to-destination for lines, and head-to-tail for trails. Audio, energy,
beat phase, and parameter drivers may change motion or intensity, but must not
select a position within these colour ramps.

`text` can use `track.title`, `track.artist`, `lyrics.current`,
`lyrics.next`, or a literal. `artwork` uses the currently playing track’s
cached artwork texture.

Approximate physics supports velocity, mass, gravity, drag, springs,
attractors/repulsors, vortex, curl noise, and bounds collisions. There is no
general rigid-body solver. Physics is intentionally “good enough” for visual
motion.

`physics.inertia` is the frame-rate-independent momentum-retention factor,
measured per nominal 60 Hz frame. It accepts a number or expression in `0...1`:

- `0` discards residual velocity immediately.
- `0.9` settles quickly and follows new forces tightly.
- `0.985` is the default, giving smooth but controlled motion.
- `0.999` produces long, weighty gliding motion.
- `1` preserves velocity until drag, a collision, or another force changes it.

At runtime the retained fraction is `pow(inertia, delta * 60)`, so a module
keeps approximately the same movement character if frames are skipped.
`mass` remains the force-response control: higher mass accelerates less.
Use `mass` for apparent weight, `inertia` for movement smoothness, and `drag`
for continuous environmental resistance. Inertia is evaluated when an entity
is spawned; use a module setting expression when authors should tune it from
the dashboard:

```yaml
settings:
  - { id: smoothness, label: Movement smoothness, min: 0.8, max: 1, step: 0.001, default: 0.985 }
templates:
  mote:
    physics:
      mass: 1
      inertia: "=settings.smoothness"
      drag: 0.04
```

Children inherit the parent transform. Emitters may spawn a template that has
children or another emitter, up to four spawn levels.

## 5. Emitters

```yaml
emitter:
  template: mote
  trigger: beat
  rate: 20
  burst: 8
  maxParticles: 2048
  lifetime: [0.8, 2.2]
  position: [0, 0, 0]
  velocity:
    radial: [0.1, 0.6]
  spread: 1
```

Triggers are `continuous`, `spawn`, `death`, `collision`, `boundary`, `beat`,
`bar`, `lyric`, `threshold`, `timer`, or `received`. `rate` is per second;
`burst` is the count for discrete triggers. Particle transforms and lifetimes
are integrated in Metal compute passes.

## 6. Fields

A field owns a population of instances of a reusable template:

```yaml
templates:
  field-node:
    render:
      primitive: sphere
      material: emissive
      colorStart: "=palette.primary"
      colorEnd: "=palette.secondary"
      glow: "=field.energy"
    physics:
      mass: 1

scene:
  - id: membrane
    field:
      layout: grid
      resolution: [48, 27]
      count: 1296
      density: "=settings.complexity"
      template: field-node
      spacing: [0.07, 0.07]
      jitter: 0
      topology: grid
      neighbourRadius: 0.12
      nearestCount: 4
      channels:
        energy: 0
        displacement: 0
        charge: 0
      boundary: bounce
```

Layouts are:

- `grid`: rectangular 2D/3D lattice using `resolution`.
- `radial`: points distributed around a circle/sphere.
- `random`: deterministic seeded distribution inside bounds.
- `line`: evenly spaced between two endpoints.
- `volume`: deterministic distribution through a 3D box.
- `meshSurface`: distribution over a declared primitive mesh.

Topologies are:

- `grid`: direct lattice neighbours.
- `radius`: all field entities within `neighbourRadius`.
- `nearest`: nearest `nearestCount` entities.
- `none`: no neighbour propagation.

Fields use a uniform spatial hash and struct-of-arrays storage. Named channels
are scalar or vector state values that expressions and effects may read as
`field.<channel>`.

`density` is an optional finite number or expression in `0.05...1`. It is
evaluated when the module or its settings change. For a grid field, Phonoscope
scales each grid axis proportionally and continues to span the declared bounds,
so it is suitable for a dashboard complexity slider that reduces both simulated
entities and rendered instances. A field without `density` remains at its full
declared population.

## 7. Effect sources, receivers, and propagation

Any entity or field may originate physical/visual effects:

```yaml
effectSources:
  - id: beat-wave
    trigger: beat
    shape: circle
    kind: wave
    propagation: neighbours
    strength: "=0.2 + audio.bass * settings.intensity"
    speed: 1.4
    falloff: 0.7
    duration: 1
    channel: energy
```

Source triggers are `spawn`, `death`, `collision`, `boundary`, `beat`, `bar`,
`lyric`, `threshold`, `timer`, and `received`.

Shapes are `point`, `line`, `plane`, `circle`, `sphere`, `box`, and `field`.
Kinds are:

- `force`: sustained acceleration.
- `impulse`: one-time velocity change.
- `wave`: delayed travelling channel/transform change.
- `channel`: write/add to a named field channel.
- `spawn`: request an emitter burst.
- `material`: modify color, opacity, emission, or glow.
- `custom`: named numeric signal for another receiver.

Propagation modes are:

- `radial`: moves outward through world space.
- `neighbours`: traverses the field topology.
- `diffusion`: spreads and attenuates through neighbours.
- `overlap`: immediately affects overlapping receivers.

Receivers map an incoming effect to state:

```yaml
effectReceivers:
  - accepts: [wave, impulse]
    channel: energy
    operation: add
    target: field.energy
    scale: 1
  - accepts: [wave]
    operation: impulse
    target: physics.velocity
    axis: normal
    scale: "=effect.strength * 0.4"
  - accepts: [wave]
    operation: emit
    target: secondary-ripple
    threshold: 0.3
```

An entity affected by a field may emit a secondary effect. Fields can overlap
and affect one another. Feedback is supported but bounded:

1. Every effect receives `(tickID, sourceHandle, effectSequence)`.
2. A receiver processes that token only once in a physics tick.
3. A returning token is a round trip and is discarded.
4. An effect stops after eight hops, 8,192 deliveries, or the 4 ms CPU budget.
5. Unprocessed deliveries are dropped at tick end, not queued for later.
6. A repeating source creates a new token on the next tick.

Design feedback effects to look attractive when some distant propagation is
dropped. Exact conservation or deterministic delivery counts are not promised.

## 8. Bounds and boundary behavior

The module boundary is inherited by fields/entities/emitters unless overridden:

- `despawn`: remove the entity.
- `wrap`: enter at the opposite face.
- `bounce`: reflect velocity using `restitution`.
- `slide`: remove normal velocity and preserve tangential velocity.
- `clamp`: pin position to the edge.
- `respawn`: restart using emitter/field initial state.
- `trigger`: emit an effect, then apply `then`.

Example:

```yaml
boundary:
  mode: trigger
  effect: edge-flash
  then: bounce
  restitution: 0.75
```

## 9. Expressions

Any documented numeric, vector, or color value may be replaced by a string
beginning with `=`. Expressions are compiled to safe typed bytecode; they are
not JavaScript or Metal source.

Operators:

```text
+ - * / % ^ < <= > >= == != && || ! unary-
```

Functions:

```text
sin cos tan abs sqrt floor ceil fract exp log
min max pow clamp mix step smoothstep noise select
vec2 vec3 vec4
```

Inputs:

| Prefix | Meaning |
| --- | --- |
| `time`, `delta` | Simulation seconds and fixed timestep |
| `screen.*`, `uv.*` | Screen/normalized coordinates |
| `position.*`, `velocity.*` | Current entity state |
| `age`, `lifetime` | Entity seconds and normalized lifetime |
| `track.*` | Duration, progress, metadata-derived numeric state |
| `beat.*`, `bar.*` | Phase, pulse, index, downbeat |
| `audio.*`, `spectrum.*` | Named bands or 32 indexed bands |
| `lyrics.*` | Current line index/progress and change pulse |
| `field.*` | Named field channels |
| `effect.*` | Incoming effect strength, age, distance, hop |
| `palette.*` | Artwork/theme palette colors |
| `settings.*` | Dashboard module settings |
| `random.*` | Deterministic entity/particle random values |
| `pi`, `e` | Constants |

Examples:

```yaml
scale: "=vec3(0.2 + beat.pulse * 0.4, 0.2 + beat.pulse * 0.4, 1)"
colorStart: "=palette.primary"
colorEnd: "=palette.secondary"
glow: "=settings.intensity * (0.2 + audio.bass * 0.8)"
force: "=noise(position.x * 3, position.y * 3, time * 0.2)"
```

Expressions are capped at 64 bytecode instructions. Division by zero,
non-finite results, and missing inputs resolve to zero for that evaluation.
Random/noise is seeded by track identity, module hash, entity handle, and tick;
replaying a track produces stable structure.

## 10. Music and rich-data signals

The runtime exposes the best available tier:

- `live`: genuine local PCM-derived spectrum, reserved for future support.
- `timeline`: timestamped provider analysis and/or timed lyrics.
- `bpm`: BPM and aggregate features, procedurally synthesized per frame.
- `metadata`: track identity and playback position only.
- `idle`: no identifiable playback.

Modules must remain attractive at `bpm`, `metadata`, and `idle` tiers. Available
inputs include playback time/progress, BPM, beat/bar phase, key, energy, valence,
mood, title, artist, album, artwork, artwork palette, current/next lyric, and
lyric progress. The 32 spectrum values may be synthetic; never present them to
the user as measured audio unless the quality is `live`.

### Driver lanes

Household configuration binds those signals to settings. The unit is a **driver
lane**: one primary driver, any number of added modifier drivers, and a list of
effect bindings that all run off the combined signal. A lane lives in a named
**settings group**, which is what a colour theme group's playlist entry selects
alongside a colour theme. An effect may appear in as many lanes as you like with
different bounds each time — a medium glow on the beat and a large one on every
fourth downbeat is two lanes binding one effect.

A driver produces 0-1 each tick:

| Type | Signal |
| --- | --- |
| `beat`, `downbeat` | the frame's beat/downbeat pulse |
| `timer` | a pulse every `intervalSeconds` |
| `song` | a pulse when the track changes |
| `energy`, `bass`, `mid`, `treble` | the band maximum, followed continuously |
| `random` | one pulse per `cadence` window, at a point drawn at random inside it |

Pulse drivers carry `every` (1-16) and `offset`: the lane fires only when
`(index - offset) mod every == 0`, which is how "every fourth downbeat, starting
on the second" is expressed rather than as its own driver type.

**Random is a pulse, not a value.** A `random` driver fires exactly once per
window and runs the binding envelope like any other pulse; what is random is
*when* inside the window it fires, not how far it goes. The window is the whole
span between one firing opportunity and the next, so `every: 4` on a `downbeat`
cadence means one fire somewhere across four bars rather than a jittered hit
inside the fourth. When the window rolls over, a new moment is drawn. The
threshold is `seedFraction(stableSeed("<slotKey>:<windowKey>"))`, so every engine
jitters identically; a `song` cadence has no interior to place a fire inside and
simply fires on the track change. Because it fires once per window, a random
driver's rarity is its cadence's period, and it ranks in `strongest` and `common`
like any other pulse.

Randomising the *value* is the separate, stackable `randomValue` on a binding —
see below. Timing and value can be had in any combination.

`beat` and `downbeat` also carry `divide` (1, 2, 4 or 8), which counts in the
other direction: the pulse is split into that many events, so a `beat` driver at
`divide: 4` fires four times a beat and a `downbeat` driver at `divide: 2` twice
a bar. The event index becomes `floor((index + phase) × divide)` against the
frame's `beatPhase`/`barPhase`. Counting and subdividing are exclusive — a
subdivided driver always has `every: 1` and `offset: 0`, because which of eight
sub-beats a run begins on is not audible — and a `divide` outside 1/2/4/8 reads
as the whole pulse. A `random` driver subdivides through its `cadence`, which
narrows the window it fires inside. Modifier signals
are **summed** onto the primary and the total is guard-clamped to 0-4; there is
no operator choice.

Each binding maps the lane signal across its `[min, max]` and runs it through an
attack/hold/release envelope. What it contributes is `value - min` — the amount
above its own resting point, so two idle bindings do not stack their floors.

A binding may also set **`randomValue`**. The lane then drives to a target drawn
at random from inside `[min, max]` on each lane event, instead of always driving
to `max`. Only the top of the sweep moves: the resting value is still `min` and
the envelope still shapes the approach, so the ramp reads as the transition curve
from the bottom of the range up to whatever was drawn this time. The draw is
`seedFraction(stableSeed("<slotKey>:rnd:<eventKey>"))`, keyed off the primary
driver's event key, so it re-draws exactly when the lane fires and holds between
fires. Each binding draws from its own slot key, so two randomised effects in one
lane move independently. A level driver fires no events, so a level-driven lane
draws once and holds — the editor warns about this.

Per effect, contributions resolve by one of four **combine modes**. Rarity is
ordered `song` > `timer` (by interval) > `downbeat × every ÷ divide` >
`beat × every ÷ divide` > level drivers, ties broken by lane order; a `random`
driver ranks as its cadence:

| Wire value | Label | Resolution |
| --- | --- | --- |
| `add` | Sum | Every contribution adds together. |
| `strongest` | Least frequent lane wins | The rarest currently-firing lane takes the effect outright. |
| `common` | Most frequent lane wins | The commonest currently-firing lane takes it outright. Level drivers have no period and are excluded, exactly as they can never win `strongest`; with nothing but level lanes contributing this falls back to summing them. |
| `override` | Override | The last lane in merge order replaces the value outright, **carrying its own resting value** rather than the shared floor. This is the one mode that is a replacement rather than a contribution. |

Anything unrecognised reads as `add`, which is what every effect did before
combine modes existed.

**The ramp as a motion profile.** For a one-shot linear transition — as opposed
to a pulse envelope — the same three-thumb control is read as a trapezoidal
velocity profile: **attack is the ease-in, hold is the flat constant-velocity
middle, release is the ease-out, and the transition lasts exactly
`attack + hold + release`.** Peak velocity is whatever makes the area under the
profile 1, so lengthening the ease-in does not overshoot the end, it makes the
middle faster. Zero-length phases are skipped rather than divided by, so a bare
release is a pure ease-out and an all-zero ramp is an instant cut. This is
`phonoscopeTransitionRamp` / `nova::transitionRamp` and it is what the centre
image's transition and the rotation's `transitionSeconds` are built from. Pulse
envelopes are unchanged: there, attack rises to 1, hold stays there, and release
falls back to 0.

The result is **not** clamped to the setting's declared maximum. It is guarded
only to `[min, min + 4 × (max - min)]` and to being finite: stacked lanes are
expected to overshoot, and that is the authored look rather than an error.

Where several settings groups are selected at once, **lanes stack and scalars
layer** — every group's lanes run concurrently in group order, while a per-effect
combine mode or a static setting collides and the later group wins. Envelope
state is keyed by `settingsGroupId:laneId:bindingId`, so two groups driving one
effect keep independent envelopes.

Five effects belong to the picture rather than to any module, and no manifest
declares them: `__glowBlur`, `__glowOpacity`, `__glowBlend`, `__messageScale` and
`__hueOffset`. Two more, `__themeChange` and `__altTheme`, are pulses rather than
values — one advances the colour theme group's playlist and the other flips the
household's alt state — so both are meaningless under a level driver, and both
read their binding's ramp as the transition's motion profile rather than as an
envelope shape. `__hueOffset`, `__themeChange` and `__altTheme` are resolved by
the dashboard, which owns House Party output and rotation; the rest are resolved
by both engines.

**The centre-image transition.** Four further picture effects say how the centre
image changes when the rotation moves to an entry naming a different one:

| Effect | Range | Meaning |
| --- | --- | --- |
| `__centreTransition` | 0-2 | 0 cross-fade, 1 flip, 2 slide. Append-only. |
| `__centreTransitionAxis` | 0-360 | Integer degrees. 0 is horizontal, 90 vertical. Wrapped, so 360 is 0. |
| `__centreTransitionDivisions` | 0-10 | Cuts across the axis. Slide only. |
| `__centreTransitionReturn` | 0-1 | 0 return from the opposite edge, 1 from the origin edge. Slide only. |

All four are **override-only**: whatever a settings group stored, they combine
by `override`, because a transition is one instruction and half a flip summed
with half a slide is not a transition. That is what makes an override settings
group's transition beat the defaults' rather than adding to it. All four are
pinned values rather than ranges — a driver sweeping one would be sampled
exactly once, because:

**One control set, not four effects.** Only `__centreTransition` is offered in
the editor. The other three are its *companions*: the transition's control set
shows exactly the ones its current mode uses — the axis under a flip or a slide,
the divisions and the return edge under a slide alone — and writes them as
ordinary pinned bindings in the same lane. They are never listed in the picker,
never render on their own, and are removed with the transition that owns them.
An axis slider sitting under a cross-fade would be a control for nothing, and
the user would have had to know that. Underneath they are unchanged: four effect
ids, four bindings, one override resolution, so both engines and the conformance
corpus see exactly what they saw before.

The set always shows **the ramp**, because every transition has one. It is
authored on the `__centreTransition` binding's own envelope and resolved
last-wins over the same settings groups as the other axes, so an override
group's ramp travels with the rest of its transition. Where no settings group
binds a transition at all, the firing pulse's envelope is still the ramp — which
is what it meant before the transition modes existed, so a group authored then
keeps working untouched.

**The initiator owns the transition.** All four axes, and the ramp, are resolved
from the settings groups in effect at the instant the pulse fired — the entry
being *left* — and latched for the whole run. The entry being arrived at has no
say in how the picture gets there, and its own settings take effect only once
the transition has finished. Without the latch the outgoing half would play
under one rule and the incoming half under another, because advancing the
rotation also swaps `settingsGroupIds`. A parameter edited mid-transition
therefore lands on the next one.

The dashboard publishes the latched result as `transition` on the theme state,
with `transitionSeconds` carrying its total length (`attack + hold + release`)
for every consumer that only needs the duration — the palette chase among them.
A solo lock, a first selection and an editor preview are cuts and publish a
zero-length cross-fade.

**Transition geometry**, stated once so both engines can be tested against it —
`nova-visualiser/src/core/centre_image_transition.h` is the reference, mirrored
by `centre_image.frag` and the tvOS Metal centre pass, and locked by the
`centre-image` conformance case.

All of it happens in *aspect-corrected* frame space, `p = (uv - 0.5) ×
(frameAspect, 1)`, undone before the image's own rectangle test — rotating in
raw normalised coordinates would skew the axis on a 16:9 frame. The axis angle θ
gives an orthonormal basis: `along = (cos θ, sin θ)`, `across = (-sin θ, cos θ)`.
`progress` throughout is the ramp's output, not raw elapsed time.

- **Cross-fade** is the two-plane weighted dissolve it has always been, with
  `progress` as the incoming plane's weight. Both planes are premultiplied and
  the weights sum to 1, so it is a straight weighted sum rather than an
  over-composite.
- **Flip** collapses the image along the axis by `s = |cos(π × progress)|` —
  source coordinate `a' = a / s`, discarded below an epsilon — and draws
  **exactly one plane at a time**: the outgoing image while `progress < 0.5`,
  the incoming one at and after it. That midpoint is the swap, and it is why the
  flip reads as one object turning over rather than two images blending.
- **Slide** cuts the image into `divisions + 1` segments. A segment's index
  comes from the *across* coordinate alone, which displacement never changes, so
  it is unambiguous without a search:
  `k = clamp(floor((a_across / halfAcross × 0.5 + 0.5) × segments), 0, segments - 1)`.
  Travel alternates by parity, `dir = k even ? +1 : -1`, so 0 divisions is a
  solid image, 1 pushes the two halves apart and 2 sends the outer sections one
  way and the middle the other.
  The clear distance `D` is the smallest offset that fully clears the frame at
  that angle: `0.5 × (|cos θ| + |sin θ|) × frameSpan + halfExtent · |along|`.
  The outgoing plane leaves over the first half, `offset = dir × D × 2 ×
  progress`; the incoming plane arrives over the second, with
  `q = 2 × progress - 1`, at `offset = dir × D × (q - 1)` returning from the
  opposite edge or `-dir × D × (q - 1)` returning from the origin edge.
  Both legs are linear in `progress` — the ramp supplies all the acceleration,
  which is what makes ease-in read as the image accelerating away and ease-out
  as it settling into place.

**The alt colour theme.** A colour group entry may name a second theme in
`altThemeId`, a link into the same flat theme library rather than a theme of its
own. `__altTheme` flips one household-wide boolean, published as `altActive`
beside the theme state's already-resolved `themeId`. The state is global and the
link is per entry, so it survives the rotation moving on: going A → A-alt → B,
where B names no alt, shows B's own colours and leaves the state on, and the
next entry that does name one shows its alt. An entry with no alt therefore
never blanks and never turns the state off. A solo holds the picture, so a flip
under one changes nothing on screen.

Clients that resolve a palette from `themeId` need nothing further. The streamed
renderer indexes palettes by rotation entry, so it resolves both columns at
config-parse time and picks between them with `altActive`; an entry with no alt
has the same palette and centre image in both columns, which is why the flip can
never show a hole.

**Solo** holds the visualiser on one colour theme and/or one settings group,
overriding the rotation until it is switched off. It is resolved by the
dashboard when it publishes the theme state, which both engines already follow
as Nova's authoritative choice, so neither engine implements it. A solo is a cut
rather than a cross-fade, and one naming a deleted theme or group is simply not
a solo.

The evaluator is shared code in all three implementations
(`nova-visualiser/src/core/parameter_drivers.cpp`,
`nova-ha-dashboard/lib/phonoscope-drivers.ts`,
`nova-appletv-dashboard/.../PhonoscopeDrivers.swift`) and is covered by the
`parameter-drivers` conformance case.

## 11. Simulation and render lifecycle

Each 60 Hz tick runs:

1. Ingest newest immutable music/config snapshot.
2. Trigger sources.
3. Process bounded field/effect propagation.
4. Apply forces and semi-implicit Euler integration.
5. Apply bounds.
6. Resolve deaths/spawns within budgets.
7. Publish a double-buffered scene snapshot/GPU delta.
8. Metal compute integrates bulk particles and trails.
9. Metal renders opaque, transparent/additive, then bloom/composite passes.
10. The centre message is drawn over the composite, then the glow overlay runs
    last over everything.

The render thread never waits for simulation. If simulation misses a deadline,
the latest completed snapshot is reused or interpolated. Build effects around
continuous motion and graceful omission rather than exact event counts.

### Two conforming engines

This module format has **two independent implementations**, and a module must
look the same on both:

- **tvOS** — Swift plus Metal, in `nova-appletv-dashboard`. Runs on the Apple TV
  and is retained permanently as the fallback when the streamed renderer is
  unavailable.
- **iridium** — C++ plus GLSL, in `nova-visualiser`. Renders headlessly on the
  GPU at 4K60 and streams the result to the Apple TV.

Both consume the same compiled module JSON from
`/api/phonoscope/modules/{id}/{version}/compiled`, so nothing about authoring a
module changes. The GPU engine simulates on a fixed 1/120 s substep and
interpolates between states when rendering, which is a refinement of the tick
above rather than a different contract: `delta` is still the fixed timestep and
`physics.inertia` is still per nominal 60 Hz frame.

Both engines adapt effects from the 1080-line authoring reference. At denser
outputs, glow falloff, bloom radius, trail length/width and fluid-background
feature radius scale linearly with output height. Dot cores and grid-wire widths
do not scale. This preserves the intended effect weight at 4K without making the
wireframe geometry heavier.

The configured centre `message` and its driven scale are scene content. They
must be composited by the rendering engine before encoding/presentation, not by
a client UI overlay, so every stream rung and the web inspector show the same
frame.

### Glow overlay

After the composite, and after the centre message, one final pass lays a blurred
copy of the finished frame back over itself. It is deliberately last: the
message is part of the picture and glows with it. The layer is household
configuration rather than module content — no manifest declares it, and it
applies identically to every module.

Three parameters, bound like any other effect through the driver lanes described
in §10 under the private effect ids no manifest declares:

| Effect | Range | Default |
| --- | --- | --- |
| `__glowBlend` | 0-2: 0 is `screen`, 1 is `multiply`, 2 is `overlay`, named as Photoshop names them | 0 |
| `__glowBlur` | 0-20 | 0 |
| `__glowOpacity` | 0-100 | 0 |
| `__glowOverdrive` | 1-10 | 1 |
| `__glowClamp` | 0 or 1 | 1 |

Overdrive multiplies the blurred copy's RGB. `__glowClamp` then decides what
happens to the result: clamped — the default, and the display-referred behaviour
the blends are defined on — it is brought back into 0-1, so overdrive saturates
the glow. Unclamped it keeps its overdriven value past 1 and the blend carries
the excess, which is how the picture is deliberately blown out to white.

All three resolve through the same path as `__messageScale`. Opacity 0 is the
identity and both engines skip the pass entirely at that value, which is the
default — an unbound glow costs nothing.

The blend mode is a choice of discrete looks but every driver produces a
continuous number, so it is authored on a whole-numbered axis and both engines
snap to the nearest mode. There is deliberately no cross-fade between the blends
— a beat or downbeat driver is meant to read as a switch, not a dissolve. A
manual source is therefore the plain named choice it looks like, and a driven one
swaps the mode wherever it crosses a halfway point. Configurations written before
the mode was driven carry a plain `blendMode` string instead; it is read as the
equivalent manual source.

Modes are only ever appended to that axis. A stored driver keeps a numeric
`min`/`max` range on it, so renumbering the modes would silently repoint every
configuration that drives the parameter.

`overlay` is Photoshop's: multiply where the base pixel is dark and screen where
it is light, with the base — not the glow — choosing which. It therefore
deepens the picture's own contrast instead of uniformly lifting or crushing it.

The blur is a separable Gaussian on a quarter-resolution copy, with taps at
`i * (sigma/3)` texels for `i` in -6..6 and weights `exp(-i^2/18)`. One blur unit
is 1.2 pixels of sigma at the 1080-line authoring reference, scaled with output
height like every other pixel-sized soft effect. The blend is evaluated on
display-referred colour, so the blurred copy is clamped to 0-1 first; coverage
(alpha) passes through untouched, because this is a look applied to the picture
rather than a layer of its own.

`multiply` is `base * (1 - opacity + glow * opacity)`; `screen` is
`base + opacity * (glow - base * glow)`.

One engine cannot do this exactly. On the tvOS fallback the centre message and
the letterboxed fluid backdrop live in SwiftUI either side of the Metal view and
cannot be sampled into its final pass, so the same blur and blend are applied to
those layers individually. It is an approximation of an effect the streamed
renderer performs in one pass over the whole frame, and the streamed renderer is
the reference.

**Any change to this spec, or to either engine's behaviour, must update the
conformance corpus in `nova-visualiser/tests/conformance` and pass on both.**
Run it with:

```sh
nova-visualiser-conformance --corpus tests/conformance
```

Determinism is a requirement of that corpus, so the per-module random seed is an
explicit FNV-1a over the module id on both engines — never a language-provided
string hash, which Swift salts per process.

## 12. Minimal complete module

```yaml
engineVersion: 1
id: hello-phonoscope
version: 1.0.0
name: Hello Phonoscope
dimension: 2d
bounds: { min: [-1.7778, -1], max: [1.7778, 1] }
boundary: wrap
settings:
  - { id: intensity, label: Intensity, min: 0, max: 2, step: 0.05, default: 1 }
templates:
  pulse:
    render:
      primitive: ring
      material: emissive
      colorStart: "=palette.primary"
      colorEnd: "=palette.secondary"
      glow: "=beat.pulse * settings.intensity"
    transform:
      scale: "=vec3(0.25 + beat.phase * 0.5, 0.25 + beat.phase * 0.5, 1)"
scene:
  - { id: pulse, template: pulse }
resources:
  maxParticles: 1024
  maxInteractiveFieldEntities: 256
  maxRenderBatches: 8
```

Before delivering a module, validate its YAML, package it, validate the ZIP,
increment the semantic version for revisions, and ensure every referenced
texture is present under `assets/`.
