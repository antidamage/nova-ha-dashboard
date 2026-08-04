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

Controls may declare `section: physics` (or another short label). The dashboard
groups controls with the same label inside a collapsed subsection; controls
without a section remain in the general group.

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

Three parameters, from `phonoscope.glowOverlay` in dashboard preferences:

| Field | Range | Driver |
| --- | --- | --- |
| `blendModeSource` | 0-1: 0 is `screen`, 1 is `multiply`, named as Photoshop names them | full parameter driver |
| `blurSource` | 0-20 | full parameter driver |
| `opacitySource` | 0-100 | full parameter driver |

All three resolve through the same path as `messageScaleSource`, under the
private setting ids `__glowBlend`, `__glowBlur` and `__glowOpacity`. Opacity 0 is
the identity and both engines skip the pass entirely at that value, which is the
default.

The blend mode is a choice of two looks but every driver produces a continuous
number, so it is authored on a 0-1 axis and both engines cut hard at 0.5:
anything below is `screen`, 0.5 and above is `multiply`. There is deliberately
no cross-fade between the two blends — a beat or downbeat driver is meant to
read as a switch, not a dissolve. A manual source is therefore the plain two-way
choice it looks like, and a driven one swaps the mode wherever it crosses the
midpoint. Configurations written before the mode was driven carry a plain
`blendMode` string instead; it is read as the equivalent manual source.

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
