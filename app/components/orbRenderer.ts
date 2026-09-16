"use client";

// Canvas 2D renderer for status orb modules.
//
// `createOrbRenderer(module)` builds a stateful renderer for one module: the
// declarative layer list is interpreted in order every frame, and arcField
// layers keep per-segment animation state inside the renderer instance (so a
// module switch resets the animation cleanly, while theme/color edits do not
// touch it at all — colors are resolved per frame from the palette).
//
// The Apple TV client implements this same interpretation with Core Graphics;
// the unit-space/turns/blend contract lives in lib/orb-modules.ts so the two
// renderers cannot drift on data semantics.

//
// Facade (specs/agent-token-footprint.md §3.3). The body lives in
// avatar/orb-renderer/:
//
//   types.ts         OrbFrame, OrbRenderer, per-layer animation state
//   constants.ts     TWO_PI, blend map, turbulence sample count
//   motion-model.ts  arcField / lineField / turbulent-ring motion (pure)
//   draw-shapes.ts   paint helpers; disc, arc, line, polygon painters
//   draw-rings.ts    ring painter, including turbulence and inner shadow
//   draw-fields.ts   arcField and lineField painters
//   renderer.ts      createOrbRenderer: owns the per-instance animation state

export type { OrbColorRef, OrbFrame, OrbRenderer } from "./avatar/orb-renderer/types";
export { createOrbRenderer } from "./avatar/orb-renderer/renderer";
