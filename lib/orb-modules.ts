// Status Orb module model.
//
// A "status orb module" is a small, platform-neutral JSON document that
// declares the orb's entire draw stack as an ordered list of layers. The web
// dashboard (canvas 2D) and the Apple TV dashboard (Core Graphics) each ship a
// renderer that interprets the same document, so a new orb look can be added
// by dropping a JSON file into `config/orb-modules/` on the host — no app
// update required on either platform.
//
// Design rules that keep the format portable and hand-editable:
//   - Unit space: the orb radius is 1.0 and the orb center is (0, 0), with
//     +x right and +y down. Every length in a module is a fraction of the orb
//     radius, so the same module renders identically at any pixel size.
//   - Angles are in TURNS (0..1 of a full revolution, clockwise from the
//     3 o'clock direction). Turns avoid the degrees-vs-radians mismatches
//     that plague cross-platform ports.
//   - Colors reference theme slots by name (so every module re-skins itself
//     from the active dashboard theme) or carry a hard-coded hex value.
//   - Blend modes are restricted to a four-mode set that maps 1:1 onto both
//     canvas `globalCompositeOperation` and tvOS `CGBlendMode`.
//
// This file is intentionally free of React/DOM/fs imports: it is shared by
// the `/api/orb-modules` server route, the browser renderer, and the tests.

// Package layout (lib/orb-modules/):
//   constants.ts, types.ts, layer-types.ts  the format itself
//   value-model.ts                          primitive coercion
//   paint-model.ts, layer-model.ts,
//   module-model.ts                         normalization
//   settings-model.ts                       per-frame setting resolution
//   catalogue.ts + <name>.data.ts           built-in modules
//   color-model.ts                          colour resolution

export {
  FALLBACK_ORB_MODULE_ID,
  ORB_BLEND_MODES,
  ORB_MODULE_FORMAT_VERSION,
  ORB_THEME_SLOTS,
} from "./orb-modules/constants";
export type {
  OrbBlendMode,
  OrbColorRef,
  OrbFieldColorMode,
  OrbGradientCircle,
  OrbGradientStop,
  OrbInnerShadow,
  OrbLayerBase,
  OrbLayerGate,
  OrbLayerPulse,
  OrbLinearGradient,
  OrbModuleSettingDecl,
  OrbPoint,
  OrbRingTurbulence,
  OrbSettingValue,
  OrbThemeSlot,
  OrbTrack,
} from "./orb-modules/types";
export type {
  OrbArcFieldLayer,
  OrbArcLayer,
  OrbDiscLayer,
  OrbLayer,
  OrbLayerType,
  OrbLineFieldLayer,
  OrbLineLayer,
  OrbModule,
  OrbPolygonLayer,
  OrbRingLayer,
} from "./orb-modules/layer-types";
export { isValidOrbModuleId } from "./orb-modules/value-model";
export { normalizeOrbColorRef } from "./orb-modules/paint-model";
export { normalizeOrbLayer } from "./orb-modules/layer-model";
export {
  orbLayerGateOpen,
  orbSettingNumber,
  resolveOrbModuleSettings,
} from "./orb-modules/settings-model";
export { normalizeOrbModule } from "./orb-modules/module-model";
export {
  BUILTIN_ORB_MODULE_MAP,
  BUILTIN_ORB_MODULES,
  resolveOrbModule,
} from "./orb-modules/catalogue";
export type { OrbPalette, OrbResolvedColor } from "./orb-modules/color-model";
export { hexToRgb, resolveOrbColor } from "./orb-modules/color-model";
