"use client";

// "Liquid glass" overlay for the status orb.
//
// The orb itself is a 2D canvas (see NovaAvatar + orbRenderer). This module
// adds the DOM/SVG glass treatment that sits on top of it:
//
//   1. A chained SVG `feDisplacementMap` stack driven by generated concentric
//      lens maps. Each smaller circular stage compounds the previous stage,
//      so the backdrop bends through a layered glass-ball profile.
//   2. A screen-blended reflection of a grey/silver room with overhead lights
//      that pans across the orb as it moves on the page / the pointer sweeps —
//      the give-away that you're looking at a shiny convex surface.
//   3. A gloss highlight for the fixed key light, over the top-left.
//
// Everything here is DOM-only (SVG filters + CSS blend modes), so — unlike the
// cross-platform orb modules — there is no tvOS counterpart; the Apple TV
// renderer simply never draws it. All knobs come from the theme's
// `glass` block (NovaGlassSettings), 0-100 magnitudes mapped to concrete
// filter/pixel values by the small helpers below.

//
// Facade (specs/agent-token-footprint.md §3.3). The body lives in
// avatar/orb-glass/:
//
//   glass-model.ts                knob -> CSS/filter value helpers
//   lens-maps-model.ts            displacement map generation
//   NovaOrbGlassBackdropCopy.tsx  the WebKit refraction layer
//   NovaOrbGlassFilter.tsx        the hidden SVG lens filter
//   NovaOrbGlassLayers.tsx        reflection + gloss; owns the drift loop

export {
  glassBoxShadow,
  glassCanvasMask,
  glassCanvasOpacity,
  glassCopyBlurPx,
  glassCssBackdropFilter,
  glassDisplaceScale,
  glassImageBlur,
  glassRefractionOpacity,
  supportsSvgBackdropFilter,
} from "./avatar/orb-glass/glass-model";
export {
  CONCENTRIC_LENS_LAYER_COUNT,
  buildImageTransformMap,
  buildLensDisplacementMap,
  concentricLayerRadius,
  concentricLayerScale,
  imageTransformDisplacement,
  refractDomeFullness,
  refractMagnitude,
} from "./avatar/orb-glass/lens-maps-model";
export { NovaOrbGlassBackdropCopy } from "./avatar/orb-glass/NovaOrbGlassBackdropCopy";
export { NovaOrbGlassFilter } from "./avatar/orb-glass/NovaOrbGlassFilter";
export { NovaOrbGlassLayers } from "./avatar/orb-glass/NovaOrbGlassLayers";
