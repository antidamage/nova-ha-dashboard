# Status Orb Modules

Each `*.json` file in this directory is one **status orb module**: a
declarative description of the orb's draw stack. Files dropped here are
picked up by `GET /api/orb-modules` on the next request — no app rebuild or
redeploy — and become selectable in the dashboard config (Theme Settings →
Status Orb → Orb style) and on the Apple TV.

A file whose `id` matches a built-in module (`classic`, `reactor`, `halo`,
`cross`) **replaces** that built-in, which is how a deployed host can patch a
built-in look in place. Invalid files are skipped and reported in the API response's
`errors` array; they never break the orb.

The authoritative format documentation lives in `lib/orb-modules.ts` (types +
normalization) and SPEC.md ("Status Orb Modules"). The short version:

- **Unit space** — the orb radius is `1.0`, center `(0, 0)`, +y down. Every
  length is a fraction of the orb radius.
- **Angles** are in turns (`0..1` per revolution, clockwise from 3 o'clock).
- **Colors** reference theme slots (`gradientCenter`, `gradientOuter`,
  `gradientAlert`, `line1..3`, `gymNumber`, `innerShadow`) or hard-coded hex:
  `{ "theme": "line1" }`, `{ "hex": "#80ff00", "alpha": 0.5 }`. Add
  `"alertTheme": "gradientAlert"` to make a color pulse toward the alert
  color while the gym alert is active.
- **Blend modes** — `normal`, `additive`, `screen`, `multiply`.
- **Layer types** — `disc` (filled circle/ellipse with radial gradient),
  `ring` (stroked circle), `arc` (stroked partial arc with a gradient along
  its sweep), `arcField` (the animated, load-reactive segment swarm), `line`
  (a single straight stroked segment), `polygon` (stroked or filled shape
  from explicit points), and `lineField` (animated segments bouncing along
  straight tracks, growing with load — see the built-in `cross` module).
- **Field color assignment** — `arcField`/`lineField` take `colorMode`:
  `"cycle"` (round-robin, default) or `"random"`.
- Layers render in array order; per-layer extras: `opacity`, `clip` (confine
  to the orb disc), `glow`, and `pulse` (opacity oscillation, optionally
  `alertOnly`).

`aurora.json` in this directory is a working example to copy from.
