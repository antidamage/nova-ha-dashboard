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

import { decimalStepGranularity } from "./slider-step";

// ---------------------------------------------------------------------------
// Color references
// ---------------------------------------------------------------------------

/**
 * Theme color slots a module layer may reference. These are the existing
 * Status Orb theme colors (see `avatarThemeModel.ts`), so every module —
 * regardless of its layer stack — recolors itself from the same user-edited
 * theme values:
 *   - gradientCenter / gradientOuter: the orb background gradient pair.
 *   - gradientAlert: the gym-overdue alert color (used as a pulse target).
 *   - line1/line2/line3: the three arc colors. Their per-line 0-100 theme
 *     opacities are baked into the resolved palette alpha.
 *   - gymNumber: the gym counter color (with its theme opacity baked in).
 *   - innerShadow: black at the theme's `innerShadowOpacity` — the orb's
 *     dark bevel/vignette strength, exposed as a color so modules can reuse it.
 */
export const ORB_THEME_SLOTS = [
  "gradientCenter",
  "gradientOuter",
  "gradientAlert",
  "line1",
  "line2",
  "line3",
  "gymNumber",
  "innerShadow",
] as const;

export type OrbThemeSlot = (typeof ORB_THEME_SLOTS)[number];

/**
 * A color used by a layer. Exactly one of `theme` or `hex` should be set
 * (theme wins when both are present). `alpha` multiplies whatever alpha the
 * referenced color already carries. When `alertTheme` is set, the resolved
 * color is mixed toward that slot by the orb's alert pulse (0..1) whenever
 * the gym alert is active — this is how the classic orb's outer gradient
 * pulses red without any module-specific code in the renderers.
 */
export type OrbColorRef = {
  theme?: OrbThemeSlot;
  /** Hard-coded fallback color as #rgb or #rrggbb. */
  hex?: string;
  /** 0..1 alpha multiplier applied on top of the referenced color's alpha. */
  alpha?: number;
  /** Optional theme slot to pulse toward while the alert is active. */
  alertTheme?: OrbThemeSlot;
};

/** A gradient stop: `at` is the 0..1 position along the gradient. */
export type OrbGradientStop = {
  at: number;
  color: OrbColorRef;
};

// ---------------------------------------------------------------------------
// Blend modes
// ---------------------------------------------------------------------------

/**
 * Cross-platform blend modes. Each maps directly to a canvas composite op and
 * a CGBlendMode, so renderers never need to emulate blending:
 *   normal   -> "source-over" / .normal
 *   additive -> "lighter"     / .plusLighter
 *   screen   -> "screen"      / .screen
 *   multiply -> "multiply"    / .multiply
 */
export const ORB_BLEND_MODES = ["normal", "additive", "screen", "multiply"] as const;
export type OrbBlendMode = (typeof ORB_BLEND_MODES)[number];

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/**
 * Optional per-layer opacity oscillation. Layer opacity is multiplied by a
 * cosine wave between `min` and `max` over `period` seconds. With
 * `alertOnly: true` the layer is hidden entirely until the gym alert
 * activates, then pulses — the building block for alert-flash layers.
 */
export type OrbLayerPulse = {
  /** Seconds for one full oscillation. */
  period: number;
  /** Opacity multiplier at the wave trough (0..1). */
  min: number;
  /** Opacity multiplier at the wave peak (0..1). */
  max: number;
  /** When true the layer only renders (and pulses) while the alert is active. */
  alertOnly?: boolean;
};

/** Fields shared by every layer type. */
export type OrbLayerBase = {
  /** Optional editor-facing identifier; renderers ignore it. */
  id?: string;
  /** Layers render in array order; disabled layers are skipped. */
  enabled?: boolean;
  /** Cross-platform blend mode, default "normal". */
  blend?: OrbBlendMode;
  /** 0..1 opacity multiplier applied to the whole layer, default 1. */
  opacity?: number;
  /**
   * When true the layer is clipped to the orb's unit disc, so highlights and
   * gradients cannot spill past the rim (used by the glass gloss stack).
   */
  clip?: boolean;
  /**
   * Soft glow radius as a fraction of the orb radius (0 = no glow). Maps to
   * canvas shadowBlur / CG shadow with the layer's own color.
   */
  glow?: number;
  /** Optional opacity oscillation (see OrbLayerPulse). */
  pulse?: OrbLayerPulse;
};

/** A point in orb unit space (orb radius = 1, center = 0,0, +y down). */
export type OrbPoint = { x: number; y: number };

/** A radial-gradient focus circle: center plus radius, all in unit space. */
export type OrbGradientCircle = OrbPoint & { radius: number };

/**
 * `disc` — a filled circle or ellipse carrying a radial gradient.
 * Covers solid fills (single stop), background gradients, vignettes
 * (offset gradient circles), and soft elliptical highlights.
 */
export type OrbDiscLayer = OrbLayerBase & {
  type: "disc";
  /** Shape center in unit space, default (0,0). */
  center?: OrbPoint;
  /** Shape radius along x, default 1 (the orb rim). */
  radius?: number;
  /** Height/width ratio for ellipses, default 1 (circle). */
  scaleY?: number;
  /** Shape rotation in turns, default 0. Only meaningful for ellipses. */
  rotation?: number;
  /**
   * Radial gradient focus circles. Defaults trace a plain center-out
   * gradient across the shape, i.e. from = {center, 0} and
   * to = {center, radius}. Offsetting them creates vignettes and the
   * "lit from above" gloss falloffs. The gradient is always circular in
   * unit space, even when the disc itself is an ellipse — that matches how
   * the original hand-written orb drew its cap highlight.
   */
  gradientFrom?: OrbGradientCircle;
  gradientTo?: OrbGradientCircle;
  /** Gradient stops; a single stop renders as a solid fill. */
  stops: OrbGradientStop[];
};

/**
 * A numeric layer parameter that is either a literal or bound to one of the
 * module's declared settings (see `OrbModule.settings`) by id. A binding to
 * an unknown/undeclared id resolves to the parameter's built-in default at
 * render time — a bad binding degrades that one knob, never the layer.
 */
export type OrbSettingValue = number | { setting: string };

/**
 * Optional organic distortion for `ring` layers. All knobs are 0-100 except
 * `fibers` (a count); every field may be bound to a module setting so the
 * config UI can expose it as a slider. At the calm end (fibers 1, chaos 0)
 * the ring is a perfect circle, optionally breathing via `pulse`; at the
 * wild end it becomes a swarm of weaving, crackling lightning strands.
 * Renderers that predate this block (tvOS today) ignore it and draw the
 * plain ring — graceful degrade by design.
 */
export type OrbRingTurbulence = {
  /** Strand count drawn around the ring, 1-12. 1 = a single line. */
  fibers?: OrbSettingValue;
  /** 0-100 radial noise amplitude + jaggedness. 0 = perfect circle. */
  chaos?: OrbSettingValue;
  /** 0-100 per-strand phase divergence — how independently strands wander and cross. */
  weave?: OrbSettingValue;
  /** 0-100 animation rate: noise drift and pulse frequency. */
  speed?: OrbSettingValue;
  /** 0-100 radius breathing depth (the "gentle pulsating circle"). */
  pulse?: OrbSettingValue;
  /** 0-100 softening: raises glow blur and mellows the strand cores. */
  softness?: OrbSettingValue;
};

/**
 * `ring` — a stroked full circle with a single color. Used for bevel lines
 * and alert halos. With a `turbulence` block the circle can distort into
 * animated fibre strands (see OrbRingTurbulence).
 */
export type OrbRingLayer = OrbLayerBase & {
  type: "ring";
  /** Ring radius in unit space. */
  radius: number;
  /** Stroke width as a fraction of the orb radius. */
  width: number;
  color: OrbColorRef;
  /** Optional user-tunable distortion; absent = plain circle. */
  turbulence?: OrbRingTurbulence;
};

/**
 * `arc` — a stroked partial arc whose color is a linear gradient laid from
 * the arc's start endpoint to its end endpoint (so the brightness tapers
 * along the sweep). Used for rim streaks, refraction bands, and lower-edge
 * reflections.
 */
export type OrbArcLayer = OrbLayerBase & {
  type: "arc";
  /** Arc radius in unit space. */
  radius: number;
  /** Stroke width as a fraction of the orb radius. */
  width: number;
  /** Start/end angles in turns, clockwise from 3 o'clock. */
  from: number;
  to: number;
  /** Stroke cap, default "round". */
  cap?: "round" | "butt";
  /** When true the gradient runs end-to-start instead of start-to-end. */
  reverse?: boolean;
  stops: OrbGradientStop[];
};

/**
 * How animated field layers assign colors to their segments:
 *   "cycle"  - round-robin through `colors` (segment i uses colors[i % n]),
 *              the default and the original arcField behavior.
 *   "random" - each segment picks one of `colors` at random on creation.
 */
export type OrbFieldColorMode = "cycle" | "random";

/**
 * `arcField` — the animated, load-reactive field of glowing arc segments.
 * This is the "alive" part of the orb: each segment independently resamples
 * a target sweep length and angular velocity on a randomized interval, both
 * scaled by the current host load, and eases toward them every frame.
 *
 * All angular quantities are in turns; speeds are turns/second.
 */
export type OrbArcFieldLayer = OrbLayerBase & {
  type: "arcField";
  /** Number of animated segments. */
  count: number;
  /** Radial band the segments occupy (unit space). */
  radiusMin: number;
  radiusMax: number;
  /**
   * How segment radii are placed inside the band:
   *   "spread" - evenly distributed with per-segment jitter (classic look).
   *   "rings"  - snapped onto `ringCount` evenly spaced concentric rings.
   */
  distribution?: "spread" | "rings";
  /** Ring count for the "rings" distribution, default 3. */
  ringCount?: number;
  /** Random radius jitter (+/- half this value) applied per segment. */
  ringJitter?: number;
  /** Per-segment stroke width range, fractions of the orb radius. */
  widthMin: number;
  widthMax: number;
  /** Segment colors, assigned per `colorMode` (default round-robin cycle). */
  colors: OrbColorRef[];
  /** Color assignment strategy, default "cycle". */
  colorMode?: OrbFieldColorMode;
  /** Stroke cap, default "round". */
  cap?: "round" | "butt";
  /** Idle sweep-length range in turns (the tiny dots when load is ~0). */
  idleSweepMin: number;
  idleSweepMax: number;
  /** Sweep length in turns a segment grows toward at full load. */
  loadSweep: number;
  /** Base angular speed range sampled per resample, turns/second. */
  speedMin: number;
  speedMax: number;
  /** Extra angular speed added at full load, turns/second. */
  loadSpeed: number;
  /** Easing rates (per-second factors) toward sweep/velocity targets. */
  sweepEase?: number;
  velocityEase?: number;
  /** Seconds between target resamples: min + random * jitter. */
  resampleMin?: number;
  resampleJitter?: number;
};

/**
 * `line` — a single stroked straight segment with one color. The building
 * block for cross/sigil-style modules (e.g. the bars of an X).
 */
export type OrbLineLayer = OrbLayerBase & {
  type: "line";
  /** Segment endpoints in unit space. */
  from: OrbPoint;
  to: OrbPoint;
  /** Stroke width as a fraction of the orb radius. */
  width: number;
  color: OrbColorRef;
  /** Stroke cap, default "round". */
  cap?: "round" | "butt";
};

/**
 * `polygon` — a stroked or filled polygon/polyline from explicit unit-space
 * points. Used for diamond frames, corner accents, tick marks, and any
 * straight-edged chrome an orb design needs.
 */
export type OrbPolygonLayer = OrbLayerBase & {
  type: "polygon";
  /** Vertices in unit space; at least three. */
  points: OrbPoint[];
  color: OrbColorRef;
  /** When true the shape is filled; otherwise it is stroked with `width`. */
  fill?: boolean;
  /** Stroke width (fraction of orb radius); ignored when `fill` is true. */
  width?: number;
  /** Set false to leave the path open (a polyline), default true. */
  close?: boolean;
};

/** A straight path an animated lineField segment travels along. */
export type OrbTrack = {
  from: OrbPoint;
  to: OrbPoint;
};

/**
 * `lineField` — the linear counterpart to `arcField`: a set of animated
 * stroked segments that ride back and forth along straight tracks. Segments
 * are assigned to tracks round-robin (so two tracks split the population in
 * half), start at random positions so they are desynced, grow longer with
 * host load, bounce off the track ends, and randomly reverse direction when
 * their motion targets resample. Sweep/velocity changes are eased, so all
 * movement is lerped.
 *
 * Positions and lengths are fractions of the track length (0..1); speeds are
 * track-lengths per second.
 */
export type OrbLineFieldLayer = OrbLayerBase & {
  type: "lineField";
  /** Number of animated segments. */
  count: number;
  /** Tracks the segments ride along; segment i uses tracks[i % n]. */
  tracks: OrbTrack[];
  /** Per-segment stroke width range, fractions of the orb radius. */
  widthMin: number;
  widthMax: number;
  /** Segment colors, assigned per `colorMode` (default round-robin cycle). */
  colors: OrbColorRef[];
  /** Color assignment strategy, default "cycle". */
  colorMode?: OrbFieldColorMode;
  /** Stroke cap, default "round". */
  cap?: "round" | "butt";
  /** Idle length range (fractions of the track) when load is ~0. */
  idleLengthMin: number;
  idleLengthMax: number;
  /** Length a segment grows toward at full load (fraction of the track). */
  loadLength: number;
  /** Base travel speed range sampled per resample, track-lengths/second. */
  speedMin: number;
  speedMax: number;
  /** Extra travel speed added at full load, track-lengths/second. */
  loadSpeed: number;
  /** Easing rates (per-second factors) toward length/velocity targets. */
  lengthEase?: number;
  velocityEase?: number;
  /** Seconds between target resamples: min + random * jitter. */
  resampleMin?: number;
  resampleJitter?: number;
};

export type OrbLayer =
  | OrbDiscLayer
  | OrbRingLayer
  | OrbArcLayer
  | OrbArcFieldLayer
  | OrbLineLayer
  | OrbPolygonLayer
  | OrbLineFieldLayer;
export type OrbLayerType = OrbLayer["type"];

// ---------------------------------------------------------------------------
// Module document
// ---------------------------------------------------------------------------

/** Current module format version; bump when the schema changes shape. */
export const ORB_MODULE_FORMAT_VERSION = 1;

/** The id every renderer falls back to when a referenced module is missing. */
export const FALLBACK_ORB_MODULE_ID = "classic";

/**
 * A user-tunable knob a module exposes in the Status Orb config UI. Layer
 * parameters opt in by binding to the setting id (`{ setting: "chaos" }`).
 * Saved values live per module id in the avatar theme's `orbModuleSettings`
 * and are clamped back to [min, max] by `resolveOrbModuleSettings`.
 */
export type OrbModuleSettingDecl = {
  /** Slug referenced by `{ setting: id }` bindings; same charset as module ids. */
  id: string;
  /** Slider label in the config UI. */
  label: string;
  /** Optional one-line explanation shown with the slider. */
  description?: string;
  min: number;
  max: number;
  step: number;
  /** Value used until the user saves an override. */
  default: number;
};

export type OrbModule = {
  /** Schema version so future renderers can keep reading old files. */
  formatVersion: number;
  /** Unique id referenced by the theme's `avatar.orbModule` field. */
  id: string;
  /** Display name shown in the Status Orb config picker. */
  name: string;
  /** One-line description shown in the picker. */
  description: string;
  /** Seconds per gym-alert pulse cycle (drives alertTheme mixing + alertOnly pulses). */
  alertPulsePeriod: number;
  /** User-tunable knobs this module exposes (absent = no extra config UI). */
  settings?: OrbModuleSettingDecl[];
  /** Ordered draw stack, first layer at the bottom. */
  layers: OrbLayer[];
};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Coerce to a finite number, else the fallback. */
function num(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Coerce to a finite number clamped to [min, max], else the fallback. */
function clampedNum(value: unknown, fallback: number, min: number, max: number) {
  return clamp(num(value, fallback), min, max);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Module ids must be url/file-safe so they map cleanly to module filenames. */
const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

export function isValidOrbModuleId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && MODULE_ID_PATTERN.test(value);
}

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function isThemeSlot(value: unknown): value is OrbThemeSlot {
  return typeof value === "string" && (ORB_THEME_SLOTS as readonly string[]).includes(value);
}

/**
 * Normalize a color reference. Invalid refs degrade to opaque white rather
 * than failing the whole module — a wrong color is visible and debuggable,
 * a missing orb is not.
 */
export function normalizeOrbColorRef(value: unknown): OrbColorRef {
  const v = recordValue(value) ?? {};
  const ref: OrbColorRef = {};
  if (isThemeSlot(v.theme)) {
    ref.theme = v.theme;
  } else if (typeof v.hex === "string" && HEX_COLOR_PATTERN.test(v.hex)) {
    ref.hex = v.hex.toLowerCase();
  } else {
    ref.hex = "#ffffff";
  }
  if (v.alpha !== undefined) {
    ref.alpha = clampedNum(v.alpha, 1, 0, 1);
  }
  if (isThemeSlot(v.alertTheme)) {
    ref.alertTheme = v.alertTheme;
  }
  return ref;
}

/** Normalize a gradient stop list: clamp positions, sort ascending. */
function normalizeStops(value: unknown): OrbGradientStop[] {
  const list = Array.isArray(value) ? value : [];
  const stops = list
    .map((entry) => {
      const v = recordValue(entry);
      if (!v) return null;
      return {
        at: clampedNum(v.at, 0, 0, 1),
        color: normalizeOrbColorRef(v.color),
      };
    })
    .filter((stop): stop is OrbGradientStop => stop !== null)
    .sort((a, b) => a.at - b.at);
  // A gradient needs at least one stop to mean anything; default to white so
  // a malformed layer is visible rather than silently invisible.
  return stops.length > 0 ? stops : [{ at: 0, color: { hex: "#ffffff" } }];
}

function normalizePoint(value: unknown, fallback: OrbPoint): OrbPoint {
  const v = recordValue(value) ?? {};
  return {
    x: clampedNum(v.x, fallback.x, -4, 4),
    y: clampedNum(v.y, fallback.y, -4, 4),
  };
}

function normalizeGradientCircle(value: unknown, fallback: OrbGradientCircle): OrbGradientCircle {
  const v = recordValue(value) ?? {};
  return {
    ...normalizePoint(value, fallback),
    radius: clampedNum(v.radius, fallback.radius, 0, 8),
  };
}

function normalizeBlend(value: unknown): OrbBlendMode {
  return (ORB_BLEND_MODES as readonly string[]).includes(value as string)
    ? (value as OrbBlendMode)
    : "normal";
}

function normalizeCap(value: unknown): "round" | "butt" {
  return value === "butt" ? "butt" : "round";
}

function normalizePulse(value: unknown): OrbLayerPulse | undefined {
  const v = recordValue(value);
  if (!v) return undefined;
  const min = clampedNum(v.min, 0, 0, 1);
  const max = clampedNum(v.max, 1, 0, 1);
  return {
    period: clampedNum(v.period, 1.2, 0.05, 60),
    min: Math.min(min, max),
    max: Math.max(min, max),
    ...(v.alertOnly === true ? { alertOnly: true } : {}),
  };
}

/** Normalize the fields every layer type shares. */
function normalizeBase(v: Record<string, unknown>): OrbLayerBase {
  const base: OrbLayerBase = {};
  if (typeof v.id === "string" && v.id.length <= 64) base.id = v.id;
  if (v.enabled === false) base.enabled = false;
  const blend = normalizeBlend(v.blend);
  if (blend !== "normal") base.blend = blend;
  const opacity = clampedNum(v.opacity, 1, 0, 1);
  if (opacity !== 1) base.opacity = opacity;
  if (v.clip === true) base.clip = true;
  const glow = clampedNum(v.glow, 0, 0, 4);
  if (glow > 0) base.glow = glow;
  const pulse = normalizePulse(v.pulse);
  if (pulse) base.pulse = pulse;
  return base;
}

/** Normalize a literal-or-setting-bound parameter; undefined when unusable. */
function normalizeOrbSettingValue(value: unknown): OrbSettingValue | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const v = recordValue(value);
  if (v && isValidOrbModuleId(v.setting)) {
    return { setting: v.setting };
  }
  return undefined;
}

const RING_TURBULENCE_KEYS = ["fibers", "chaos", "weave", "speed", "pulse", "softness"] as const;

/**
 * Normalize a ring's turbulence block. Literal values keep their raw number
 * here (each knob has its own range, enforced at render time); invalid fields
 * are dropped individually so one bad knob never kills the block.
 */
function normalizeRingTurbulence(value: unknown): OrbRingTurbulence | undefined {
  const v = recordValue(value);
  if (!v) return undefined;
  const turbulence: OrbRingTurbulence = {};
  for (const key of RING_TURBULENCE_KEYS) {
    const normalized = normalizeOrbSettingValue(v[key]);
    if (normalized !== undefined) turbulence[key] = normalized;
  }
  return Object.keys(turbulence).length > 0 ? turbulence : undefined;
}

/** Normalize one setting declaration; null when it has no usable id. */
function normalizeOrbModuleSetting(value: unknown): OrbModuleSettingDecl | null {
  const v = recordValue(value);
  if (!v || !isValidOrbModuleId(v.id)) return null;
  const min = num(v.min, 0);
  const max = Math.max(min, num(v.max, Math.max(min, 100)));
  const span = max - min;
  const decl: OrbModuleSettingDecl = {
    id: v.id,
    label: typeof v.label === "string" && v.label.trim().length > 0
      ? v.label.trim().slice(0, 40)
      : v.id,
    min,
    max,
    step: span > 0 ? decimalStepGranularity(clampedNum(v.step, 1, 0.001, span)) : 1,
    default: clamp(num(v.default, min), min, max),
  };
  if (typeof v.description === "string" && v.description.trim().length > 0) {
    decl.description = v.description.trim().slice(0, 140);
  }
  return decl;
}

/**
 * Resolve a module's saved per-setting overrides (the avatar theme's
 * `orbModuleSettings[module.id]`) into a complete id -> value map: declared
 * defaults filled in, saved values clamped to the declared range. Shared by
 * the renderer (per frame) and the config UI (slider values).
 */
export function resolveOrbModuleSettings(
  module: OrbModule,
  saved?: Record<string, number> | null,
): Record<string, number> {
  const resolved: Record<string, number> = {};
  for (const decl of module.settings ?? []) {
    const raw = Number(saved?.[decl.id]);
    resolved[decl.id] = Number.isFinite(raw) ? clamp(raw, decl.min, decl.max) : decl.default;
  }
  return resolved;
}

/**
 * Resolve a literal-or-setting-bound layer parameter for one frame. Bindings
 * to ids absent from `settings` fall back to the caller's default — that is
 * the degrade rule for foreign/unknown setting refs.
 */
export function orbSettingNumber(
  value: OrbSettingValue | undefined,
  settings: Record<string, number> | undefined,
  fallback: number,
): number {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value === "object") {
    const bound = settings?.[value.setting];
    if (bound !== undefined && Number.isFinite(bound)) {
      return bound;
    }
  }
  return fallback;
}

/**
 * Normalize a single layer. Returns null for unknown layer types so a module
 * written for a future format version degrades gracefully instead of
 * crashing the renderer.
 */
export function normalizeOrbLayer(value: unknown): OrbLayer | null {
  const v = recordValue(value);
  if (!v) return null;

  if (v.type === "disc") {
    const center = normalizePoint(v.center, { x: 0, y: 0 });
    const radius = clampedNum(v.radius, 1, 0.001, 4);
    const layer: OrbDiscLayer = {
      ...normalizeBase(v),
      type: "disc",
      stops: normalizeStops(v.stops),
    };
    if (center.x !== 0 || center.y !== 0) layer.center = center;
    if (radius !== 1) layer.radius = radius;
    const scaleY = clampedNum(v.scaleY, 1, 0.01, 4);
    if (scaleY !== 1) layer.scaleY = scaleY;
    const rotation = clampedNum(v.rotation, 0, -1, 1);
    if (rotation !== 0) layer.rotation = rotation;
    if (v.gradientFrom !== undefined) {
      layer.gradientFrom = normalizeGradientCircle(v.gradientFrom, { ...center, radius: 0 });
    }
    if (v.gradientTo !== undefined) {
      layer.gradientTo = normalizeGradientCircle(v.gradientTo, { ...center, radius });
    }
    return layer;
  }

  if (v.type === "ring") {
    const layer: OrbRingLayer = {
      ...normalizeBase(v),
      type: "ring",
      radius: clampedNum(v.radius, 1, 0.001, 4),
      width: clampedNum(v.width, 0.02, 0.001, 2),
      color: normalizeOrbColorRef(v.color),
    };
    const turbulence = normalizeRingTurbulence(v.turbulence);
    if (turbulence) layer.turbulence = turbulence;
    return layer;
  }

  if (v.type === "arc") {
    const layer: OrbArcLayer = {
      ...normalizeBase(v),
      type: "arc",
      radius: clampedNum(v.radius, 1, 0.001, 4),
      width: clampedNum(v.width, 0.02, 0.001, 2),
      from: clampedNum(v.from, 0, -4, 4),
      to: clampedNum(v.to, 0.25, -4, 4),
      stops: normalizeStops(v.stops),
    };
    const cap = normalizeCap(v.cap);
    if (cap !== "round") layer.cap = cap;
    if (v.reverse === true) layer.reverse = true;
    return layer;
  }

  if (v.type === "arcField") {
    const radiusMin = clampedNum(v.radiusMin, 0.1, 0, 4);
    const radiusMax = Math.max(radiusMin, clampedNum(v.radiusMax, 0.95, 0, 4));
    const widthMin = clampedNum(v.widthMin, 0.01, 0.001, 1);
    const widthMax = Math.max(widthMin, clampedNum(v.widthMax, 0.08, 0.001, 1));
    const idleSweepMin = clampedNum(v.idleSweepMin, 0.00025, 0, 1);
    const idleSweepMax = Math.max(idleSweepMin, clampedNum(v.idleSweepMax, 0.001, 0, 1));
    const colorsRaw = Array.isArray(v.colors) ? v.colors : [];
    const colors = colorsRaw.map(normalizeOrbColorRef);
    const layer: OrbArcFieldLayer = {
      ...normalizeBase(v),
      type: "arcField",
      count: Math.round(clampedNum(v.count, 50, 1, 400)),
      radiusMin,
      radiusMax,
      widthMin,
      widthMax,
      // Default to the three theme line colors so a minimal arcField stanza
      // still picks up the user's palette.
      colors: colors.length > 0
        ? colors
        : [{ theme: "line1" }, { theme: "line2" }, { theme: "line3" }],
      idleSweepMin,
      idleSweepMax,
      loadSweep: clampedNum(v.loadSweep, 1, 0, 1),
      speedMin: clampedNum(v.speedMin, 0.0557, 0, 4),
      speedMax: clampedNum(v.speedMax, 0.1194, 0, 4),
      loadSpeed: clampedNum(v.loadSpeed, 0.2546, 0, 4),
    };
    if (v.distribution === "rings") {
      layer.distribution = "rings";
      layer.ringCount = Math.round(clampedNum(v.ringCount, 3, 1, 32));
    }
    const ringJitter = clampedNum(v.ringJitter, 0, 0, 1);
    if (ringJitter > 0) layer.ringJitter = ringJitter;
    if (v.colorMode === "random") layer.colorMode = "random";
    const cap = normalizeCap(v.cap);
    if (cap !== "round") layer.cap = cap;
    const sweepEase = clampedNum(v.sweepEase, 1, 0.01, 30);
    if (sweepEase !== 1) layer.sweepEase = sweepEase;
    const velocityEase = clampedNum(v.velocityEase, 1, 0.01, 30);
    if (velocityEase !== 1) layer.velocityEase = velocityEase;
    const resampleMin = clampedNum(v.resampleMin, 0.8, 0.05, 60);
    if (resampleMin !== 0.8) layer.resampleMin = resampleMin;
    const resampleJitter = clampedNum(v.resampleJitter, 0.6, 0, 60);
    if (resampleJitter !== 0.6) layer.resampleJitter = resampleJitter;
    return layer;
  }

  if (v.type === "line") {
    const layer: OrbLineLayer = {
      ...normalizeBase(v),
      type: "line",
      from: normalizePoint(v.from, { x: -1, y: 0 }),
      to: normalizePoint(v.to, { x: 1, y: 0 }),
      width: clampedNum(v.width, 0.02, 0.001, 2),
      color: normalizeOrbColorRef(v.color),
    };
    const cap = normalizeCap(v.cap);
    if (cap !== "round") layer.cap = cap;
    return layer;
  }

  if (v.type === "polygon") {
    // A polygon needs at least three vertices; anything smaller is better
    // expressed as a `line` layer, so reject it rather than guessing.
    const pointsRaw = Array.isArray(v.points) ? v.points : [];
    const points = pointsRaw.map((point) => normalizePoint(point, { x: 0, y: 0 }));
    if (points.length < 3) return null;
    const layer: OrbPolygonLayer = {
      ...normalizeBase(v),
      type: "polygon",
      points,
      color: normalizeOrbColorRef(v.color),
    };
    if (v.fill === true) {
      layer.fill = true;
    } else {
      layer.width = clampedNum(v.width, 0.02, 0.001, 2);
    }
    if (v.close === false) layer.close = false;
    return layer;
  }

  if (v.type === "lineField") {
    // Tracks default to a single horizontal diameter so a minimal stanza
    // still animates; malformed entries degrade per-point, not per-track.
    const tracksRaw = Array.isArray(v.tracks) ? v.tracks : [];
    const tracks: OrbTrack[] = tracksRaw.map((track) => {
      const t = recordValue(track) ?? {};
      return {
        from: normalizePoint(t.from, { x: -1, y: 0 }),
        to: normalizePoint(t.to, { x: 1, y: 0 }),
      };
    });
    const widthMin = clampedNum(v.widthMin, 0.01, 0.001, 1);
    const widthMax = Math.max(widthMin, clampedNum(v.widthMax, 0.08, 0.001, 1));
    const idleLengthMin = clampedNum(v.idleLengthMin, 0.05, 0, 1);
    const idleLengthMax = Math.max(idleLengthMin, clampedNum(v.idleLengthMax, 0.15, 0, 1));
    const colorsRaw = Array.isArray(v.colors) ? v.colors : [];
    const colors = colorsRaw.map(normalizeOrbColorRef);
    const layer: OrbLineFieldLayer = {
      ...normalizeBase(v),
      type: "lineField",
      count: Math.round(clampedNum(v.count, 6, 1, 400)),
      tracks: tracks.length > 0 ? tracks : [{ from: { x: -1, y: 0 }, to: { x: 1, y: 0 } }],
      widthMin,
      widthMax,
      // Default to the three theme line colors, mirroring arcField.
      colors: colors.length > 0
        ? colors
        : [{ theme: "line1" }, { theme: "line2" }, { theme: "line3" }],
      idleLengthMin,
      idleLengthMax,
      loadLength: clampedNum(v.loadLength, 0.9, 0, 1),
      speedMin: clampedNum(v.speedMin, 0.1, 0, 4),
      speedMax: clampedNum(v.speedMax, 0.3, 0, 4),
      loadSpeed: clampedNum(v.loadSpeed, 0.4, 0, 4),
    };
    if (v.colorMode === "random") layer.colorMode = "random";
    const cap = normalizeCap(v.cap);
    if (cap !== "round") layer.cap = cap;
    const lengthEase = clampedNum(v.lengthEase, 1, 0.01, 30);
    if (lengthEase !== 1) layer.lengthEase = lengthEase;
    const velocityEase = clampedNum(v.velocityEase, 1, 0.01, 30);
    if (velocityEase !== 1) layer.velocityEase = velocityEase;
    const resampleMin = clampedNum(v.resampleMin, 0.8, 0.05, 60);
    if (resampleMin !== 0.8) layer.resampleMin = resampleMin;
    const resampleJitter = clampedNum(v.resampleJitter, 0.6, 0, 60);
    if (resampleJitter !== 0.6) layer.resampleJitter = resampleJitter;
    return layer;
  }

  // Unknown layer type — skip it (forward compatibility).
  return null;
}

/**
 * Normalize a full module document. Returns null when the document is not
 * usable at all (bad id or no valid layers); callers then fall back to the
 * built-in classic module so the orb always renders something.
 */
export function normalizeOrbModule(value: unknown): OrbModule | null {
  const v = recordValue(value);
  if (!v) return null;
  if (!isValidOrbModuleId(v.id)) return null;

  // Reject documents from a NEWER major format than we understand; older or
  // missing versions are normalized forward.
  const formatVersion = Math.round(num(v.formatVersion, ORB_MODULE_FORMAT_VERSION));
  if (formatVersion > ORB_MODULE_FORMAT_VERSION) return null;

  const layersRaw = Array.isArray(v.layers) ? v.layers : [];
  const layers = layersRaw
    .map(normalizeOrbLayer)
    .filter((layer): layer is OrbLayer => layer !== null);
  if (layers.length === 0) return null;

  // Setting declarations, deduplicated by id (first declaration wins).
  const settingsRaw = Array.isArray(v.settings) ? v.settings : [];
  const settings: OrbModuleSettingDecl[] = [];
  const seenSettingIds = new Set<string>();
  for (const entry of settingsRaw) {
    const setting = normalizeOrbModuleSetting(entry);
    if (setting && !seenSettingIds.has(setting.id)) {
      seenSettingIds.add(setting.id);
      settings.push(setting);
    }
  }

  const module: OrbModule = {
    formatVersion: ORB_MODULE_FORMAT_VERSION,
    id: v.id as string,
    name: typeof v.name === "string" && v.name.trim().length > 0
      ? v.name.trim().slice(0, 80)
      : (v.id as string),
    description: typeof v.description === "string" ? v.description.trim().slice(0, 200) : "",
    alertPulsePeriod: clampedNum(v.alertPulsePeriod, 1.2, 0.05, 60),
    layers,
  };
  if (settings.length > 0) {
    module.settings = settings;
  }
  return module;
}

// ---------------------------------------------------------------------------
// Built-in modules
// ---------------------------------------------------------------------------
//
// Built-ins are compiled into both apps so the orb renders before (or
// without) a successful `/api/orb-modules` fetch. The server route merges
// these with any JSON files found in `config/orb-modules/`; a disk file with
// the same id REPLACES the built-in, which is how a deployed host can patch a
// built-in look without an app release.

/**
 * "Classic Glass" — a faithful, data-driven port of the original hand-coded
 * NovaAvatar drawing (background gradient, fifty additive arcs, bevel rings,
 * and the six-layer HAL-style gloss stack). All magic numbers were derived
 * from the previous implementation at its reference 128 px size, converted
 * into unit-space fractions of the orb radius (R = 0.48 * size, so e.g. the
 * old `size * 0.25` glow becomes 0.5208 R).
 */
const CLASSIC_MODULE: OrbModule = {
  formatVersion: 1,
  id: "classic",
  name: "Classic Glass",
  description: "Radial gradient core, fifty additive arcs, glass gloss.",
  alertPulsePeriod: 1.2,
  layers: [
    // Background — radial gradient from the theme center color to the outer
    // color; the outer stop pulses toward the alert color when the gym
    // counter is overdue (alertTheme drives the mix).
    {
      id: "background",
      type: "disc",
      stops: [
        { at: 0, color: { theme: "gradientCenter" } },
        { at: 1, color: { theme: "gradientOuter", alertTheme: "gradientAlert" } },
      ],
    },
    // The animated load field: 50 additive glowing arcs spread across the
    // orb interior, cycling through the three theme line colors.
    {
      id: "load-arcs",
      type: "arcField",
      blend: "additive",
      glow: 0.5208,
      count: 50,
      radiusMin: 0.1,
      radiusMax: 0.95,
      ringJitter: 0.08,
      widthMin: 0.0104,
      widthMax: 0.0833,
      colors: [{ theme: "line1" }, { theme: "line2" }, { theme: "line3" }],
      idleSweepMin: 0.00025,
      idleSweepMax: 0.001,
      loadSweep: 1,
      speedMin: 0.0557,
      speedMax: 0.1194,
      loadSpeed: 0.2546,
    },
    // Outer bevel — a faint white ring just past the rim.
    {
      id: "bevel-light",
      type: "ring",
      radius: 1.0081,
      width: 0.0163,
      color: { hex: "#ffffff", alpha: 0.05 },
      glow: 0.5208,
    },
    // Inner bevel shadow — dark ring inside the rim; strength follows the
    // theme's innerShadowOpacity via the innerShadow color slot.
    {
      id: "bevel-shadow",
      type: "ring",
      radius: 0.9512,
      width: 0.0488,
      color: { theme: "innerShadow" },
      glow: 0.5208,
    },
    // ---- Glass gloss stack (all clipped to the orb interior) ----
    // Bottom inner vignette: a dark gradient hugging the lower rim that
    // sells the curvature before the highlights brighten the top.
    {
      id: "bottom-vignette",
      type: "disc",
      clip: true,
      gradientFrom: { x: 0, y: 0.55, radius: 0.15 },
      gradientTo: { x: 0, y: 0.25, radius: 1.05 },
      stops: [
        { at: 0, color: { hex: "#000000", alpha: 0 } },
        { at: 0.7, color: { hex: "#000000", alpha: 0 } },
        { at: 1, color: { theme: "innerShadow" } },
      ],
    },
    // Primary cap highlight: broad soft ellipse in the upper third — the
    // "you're looking at glass" cue. Alphas are the old GLOSS_OPACITY (0.15)
    // times the per-reflection multipliers (4.5 / 1.6).
    {
      id: "cap-highlight",
      type: "disc",
      clip: true,
      center: { x: -0.0833, y: -0.42 },
      radius: 0.66,
      scaleY: 0.5152,
      rotation: -0.03,
      gradientFrom: { x: -0.0833, y: -0.318, radius: 0 },
      gradientTo: { x: -0.0833, y: -0.42, radius: 0.693 },
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0.675 } },
        { at: 0.45, color: { hex: "#ffffff", alpha: 0.24 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
    // Rim streak: bright thin arc on the upper-left rim, tapering along its
    // length (gradient runs along the sweep).
    {
      id: "rim-streak",
      type: "arc",
      clip: true,
      radius: 0.8617,
      width: 0.1058,
      from: 0.54,
      to: 0.8,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0 } },
        { at: 0.4, color: { hex: "#ffffff", alpha: 0.525 } },
        { at: 0.65, color: { hex: "#ffffff", alpha: 0.225 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
    // Secondary "kiss" highlight upper-right — a second light source.
    {
      id: "kiss-highlight",
      type: "disc",
      clip: true,
      center: { x: 0.5, y: -0.38 },
      radius: 0.16,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0.75 } },
        { at: 0.5, color: { hex: "#ffffff", alpha: 0.225 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
    // Faint refraction band low and right — adds to the wet look.
    {
      id: "refraction-band",
      type: "arc",
      clip: true,
      radius: 0.9186,
      width: 0.0651,
      from: 0.04,
      to: 0.21,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0 } },
        { at: 0.5, color: { hex: "#ffffff", alpha: 0.21 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
    // Lower-edge rim reflections, half the strength of the upper streak:
    // bottom-right fades toward bottom-center...
    {
      id: "lower-rim-right",
      type: "arc",
      clip: true,
      radius: 0.8617,
      width: 0.0895,
      from: 0.025,
      to: 0.23,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0 } },
        { at: 0.35, color: { hex: "#ffffff", alpha: 0.225 } },
        { at: 0.6, color: { hex: "#ffffff", alpha: 0.15 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
    // ...and bottom-left mirrors it with the gradient reversed so the bright
    // peak lands on the outer (left) side of the curve.
    {
      id: "lower-rim-left",
      type: "arc",
      clip: true,
      radius: 0.8617,
      width: 0.0895,
      from: 0.27,
      to: 0.475,
      reverse: true,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0 } },
        { at: 0.35, color: { hex: "#ffffff", alpha: 0.225 } },
        { at: 0.6, color: { hex: "#ffffff", alpha: 0.15 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
  ],
};

/**
 * "Reactor Core" — a denser, machine-like look: dark shell, a bright pulsing
 * core, and a few thick arcs snapped onto three concentric rings (the "rings"
 * distribution) so it reads as spinning reactor coils rather than a particle
 * cloud. Demonstrates: different layer count/order, ring distribution, screen
 * blending, and an alert-only flash ring.
 */
const REACTOR_MODULE: OrbModule = {
  formatVersion: 1,
  id: "reactor",
  name: "Reactor Core",
  description: "Bright pulsing core with thick coil arcs on three rings.",
  alertPulsePeriod: 1.0,
  layers: [
    // Dark shell: outer theme color collapsing to near-black at the rim.
    {
      id: "shell",
      type: "disc",
      stops: [
        { at: 0, color: { theme: "gradientOuter", alpha: 0.85 } },
        { at: 1, color: { hex: "#000000" } },
      ],
    },
    // Soft center energy bloom under the coils, in the theme center color.
    {
      id: "core-bloom",
      type: "disc",
      blend: "screen",
      clip: true,
      radius: 0.62,
      stops: [
        { at: 0, color: { theme: "gradientCenter" } },
        { at: 1, color: { theme: "gradientCenter", alpha: 0 } },
      ],
    },
    // Nine thick coil arcs snapped to three concentric rings. Fewer, fatter,
    // slower segments than classic — a totally different proportion language.
    {
      id: "coils",
      type: "arcField",
      blend: "additive",
      glow: 0.35,
      count: 9,
      radiusMin: 0.38,
      radiusMax: 0.86,
      distribution: "rings",
      ringCount: 3,
      widthMin: 0.05,
      widthMax: 0.09,
      colors: [{ theme: "line1" }, { theme: "line2" }, { theme: "line3" }],
      idleSweepMin: 0.06,
      idleSweepMax: 0.14,
      loadSweep: 0.42,
      speedMin: 0.02,
      speedMax: 0.07,
      loadSpeed: 0.45,
      sweepEase: 2,
      velocityEase: 2,
    },
    // White-hot core that breathes slowly on top of the coils.
    {
      id: "core",
      type: "disc",
      blend: "additive",
      radius: 0.2,
      pulse: { period: 3.2, min: 0.7, max: 1 },
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0.9 } },
        { at: 0.45, color: { theme: "gradientCenter", alpha: 0.6 } },
        { at: 1, color: { theme: "gradientCenter", alpha: 0 } },
      ],
    },
    // Containment ring at the rim in the first line color.
    {
      id: "containment-ring",
      type: "ring",
      radius: 0.96,
      width: 0.02,
      color: { theme: "line1", alpha: 0.55 },
      glow: 0.2,
    },
    // Inner shadow keeps the shell rounded; reuses the theme bevel strength.
    {
      id: "bevel-shadow",
      type: "ring",
      radius: 0.93,
      width: 0.06,
      color: { theme: "innerShadow" },
      glow: 0.3,
    },
    // Alert flash: a ring in the alert color that only exists while the gym
    // alert is active, strobing with the module's pulse period.
    {
      id: "alert-flash",
      type: "ring",
      blend: "additive",
      radius: 0.9,
      width: 0.05,
      color: { theme: "gradientAlert" },
      glow: 0.4,
      pulse: { period: 1.0, min: 0, max: 0.9, alertOnly: true },
    },
    // Single restrained cap highlight so it still reads as a physical object.
    {
      id: "cap-highlight",
      type: "disc",
      clip: true,
      center: { x: 0, y: -0.5 },
      radius: 0.55,
      scaleY: 0.45,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0.28 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
  ],
};

/**
 * "Halo" — a minimal, airy look: no filled background at all (the page shows
 * through the middle), one dominant rim ring, and a fine swarm of thin arcs
 * confined to a narrow outer band. Demonstrates: transparent-center shape,
 * a narrow radial band, many small segments, and multiply-free layering.
 */
const HALO_MODULE: OrbModule = {
  formatVersion: 1,
  id: "halo",
  name: "Halo",
  description: "Open center with a fine arc swarm on a narrow outer band.",
  alertPulsePeriod: 1.6,
  // The halo ring's turbulence knobs, surfaced as sliders in the Status Orb
  // config. Defaults sit at the calm end: a single, gently breathing circle.
  settings: [
    { id: "fibers", label: "Fibres", description: "Strands in the halo ring", min: 1, max: 12, step: 1, default: 1 },
    { id: "chaos", label: "Chaos", description: "0 = perfect circle, 100 = crackling lightning", min: 0, max: 100, step: 1, default: 0 },
    { id: "weave", label: "Weave", description: "How independently the strands wander and cross", min: 0, max: 100, step: 1, default: 30 },
    { id: "speed", label: "Speed", description: "How fast the ring pulses and the strands writhe", min: 0, max: 100, step: 1, default: 30 },
    { id: "pulse", label: "Pulse", description: "Breathing depth of the ring", min: 0, max: 100, step: 1, default: 20 },
    { id: "softness", label: "Softness", description: "Glow and edge softening on the strands", min: 0, max: 100, step: 1, default: 40 },
  ],
  layers: [
    // Soft center glow only — deliberately no opaque background disc, so the
    // halo floats over whatever is behind it.
    {
      id: "center-glow",
      type: "disc",
      blend: "screen",
      radius: 0.55,
      stops: [
        { at: 0, color: { theme: "gradientCenter", alpha: 0.5 } },
        { at: 1, color: { theme: "gradientCenter", alpha: 0 } },
      ],
    },
    // The dominant halo ring; pulses toward the alert color when overdue.
    // Every turbulence knob is bound to a module setting above, so the config
    // sliders morph it live from a perfect breathing circle into weaving
    // lightning strands.
    {
      id: "halo-ring",
      type: "ring",
      blend: "additive",
      radius: 0.8,
      width: 0.025,
      color: { theme: "gradientOuter", alpha: 0.9, alertTheme: "gradientAlert" },
      glow: 0.45,
      turbulence: {
        fibers: { setting: "fibers" },
        chaos: { setting: "chaos" },
        weave: { setting: "weave" },
        speed: { setting: "speed" },
        pulse: { setting: "pulse" },
        softness: { setting: "softness" },
      },
    },
    // Eighty hair-thin arcs in the narrow band straddling the halo ring.
    // High idle sweep keeps the band visible even at zero load; load mostly
    // adds speed rather than length, so activity reads as "spinning faster".
    {
      id: "band-swarm",
      type: "arcField",
      blend: "additive",
      glow: 0.25,
      count: 80,
      radiusMin: 0.68,
      radiusMax: 0.95,
      ringJitter: 0.04,
      widthMin: 0.006,
      widthMax: 0.016,
      colors: [{ theme: "line1" }, { theme: "line2" }, { theme: "line3" }],
      idleSweepMin: 0.02,
      idleSweepMax: 0.1,
      loadSweep: 0.35,
      speedMin: 0.03,
      speedMax: 0.09,
      loadSpeed: 0.6,
    },
    // A faint inner counter-ring for depth.
    {
      id: "inner-ring",
      type: "ring",
      radius: 0.62,
      width: 0.008,
      color: { theme: "line3", alpha: 0.35 },
    },
    // Alert beacon dot at the top of the ring, alert-only.
    {
      id: "alert-beacon",
      type: "disc",
      blend: "additive",
      center: { x: 0, y: -0.8 },
      radius: 0.09,
      pulse: { period: 1.6, min: 0, max: 1, alertOnly: true },
      stops: [
        { at: 0, color: { theme: "gradientAlert" } },
        { at: 1, color: { theme: "gradientAlert", alpha: 0 } },
      ],
    },
  ],
};

/**
 * "Cross" — a flat, sigil-like look inspired by retro game UI: a chunky X in
 * the inner gradient color sitting inside a thin diamond frame, with the
 * frame and its corner accents in the outer gradient color. Activity is shown
 * by status lines that ride along the X's two bars (a lineField with one
 * track per bar, so half the lines travel the TL-BR diagonal and half the
 * TR-BL diagonal): short at idle, longer with load, bouncing between the bar
 * ends, randomly reversing, and individually desynced. Demonstrates the
 * straight-edged primitives (line/polygon/lineField) and random color
 * assignment.
 */
const CROSS_MODULE: OrbModule = {
  formatVersion: 1,
  id: "cross",
  name: "Cross",
  description: "Diamond-framed X with status lines riding its bars.",
  alertPulsePeriod: 1.2,
  layers: [
    // Soft dark backing so the sigil and gym counter read over any page
    // content — the design is otherwise open like halo.
    {
      id: "backing",
      type: "disc",
      stops: [
        { at: 0, color: { hex: "#000000", alpha: 0.5 } },
        { at: 1, color: { hex: "#000000", alpha: 0 } },
      ],
    },
    // The X: two chunky diagonal bars in the inner gradient color. Both
    // pulse toward the alert color while the gym alert is active.
    {
      id: "x-bar-desc",
      type: "line",
      from: { x: -0.5, y: -0.5 },
      to: { x: 0.5, y: 0.5 },
      width: 0.18,
      color: { theme: "gradientCenter", alertTheme: "gradientAlert" },
      cap: "butt",
    },
    {
      id: "x-bar-asc",
      type: "line",
      from: { x: -0.5, y: 0.5 },
      to: { x: 0.5, y: -0.5 },
      width: 0.18,
      color: { theme: "gradientCenter", alertTheme: "gradientAlert" },
      cap: "butt",
    },
    // Status lines: six segments split across the two bar tracks (three per
    // diagonal), randomly colored from the theme line slots, additive so
    // they glow against the bars beneath them.
    {
      id: "status-lines",
      type: "lineField",
      blend: "additive",
      glow: 0.3,
      count: 6,
      tracks: [
        { from: { x: -0.5, y: -0.5 }, to: { x: 0.5, y: 0.5 } },
        { from: { x: -0.5, y: 0.5 }, to: { x: 0.5, y: -0.5 } },
      ],
      widthMin: 0.05,
      widthMax: 0.07,
      colors: [{ theme: "line1" }, { theme: "line2" }, { theme: "line3" }],
      colorMode: "random",
      idleLengthMin: 0.12,
      idleLengthMax: 0.22,
      loadLength: 0.9,
      speedMin: 0.12,
      speedMax: 0.3,
      loadSpeed: 0.45,
    },
    // Thin diamond frame around the X in the outer gradient color.
    {
      id: "frame",
      type: "polygon",
      points: [
        { x: 0, y: -0.92 },
        { x: 0.92, y: 0 },
        { x: 0, y: 0.92 },
        { x: -0.92, y: 0 },
      ],
      color: { theme: "gradientOuter" },
      width: 0.055,
    },
    // Small filled diamond accents just inside each frame vertex.
    {
      id: "accent-n",
      type: "polygon",
      points: [
        { x: 0, y: -0.78 },
        { x: 0.06, y: -0.72 },
        { x: 0, y: -0.66 },
        { x: -0.06, y: -0.72 },
      ],
      color: { theme: "gradientOuter" },
      fill: true,
    },
    {
      id: "accent-e",
      type: "polygon",
      points: [
        { x: 0.72, y: -0.06 },
        { x: 0.78, y: 0 },
        { x: 0.72, y: 0.06 },
        { x: 0.66, y: 0 },
      ],
      color: { theme: "gradientOuter" },
      fill: true,
    },
    {
      id: "accent-s",
      type: "polygon",
      points: [
        { x: 0, y: 0.66 },
        { x: 0.06, y: 0.72 },
        { x: 0, y: 0.78 },
        { x: -0.06, y: 0.72 },
      ],
      color: { theme: "gradientOuter" },
      fill: true,
    },
    {
      id: "accent-w",
      type: "polygon",
      points: [
        { x: -0.72, y: -0.06 },
        { x: -0.66, y: 0 },
        { x: -0.72, y: 0.06 },
        { x: -0.78, y: 0 },
      ],
      color: { theme: "gradientOuter" },
      fill: true,
    },
    // Alert flash: the frame restated in the alert color, strobing only
    // while the gym alert is active.
    {
      id: "alert-frame",
      type: "polygon",
      blend: "additive",
      glow: 0.4,
      pulse: { period: 1.2, min: 0, max: 1, alertOnly: true },
      points: [
        { x: 0, y: -0.92 },
        { x: 0.92, y: 0 },
        { x: 0, y: 0.92 },
        { x: -0.92, y: 0 },
      ],
      color: { theme: "gradientAlert" },
      width: 0.055,
    },
  ],
};

/** Built-in modules, in the order the config picker should list them. */
export const BUILTIN_ORB_MODULES: OrbModule[] = [
  CLASSIC_MODULE,
  REACTOR_MODULE,
  HALO_MODULE,
  CROSS_MODULE,
];

/** Lookup map for the built-ins. */
export const BUILTIN_ORB_MODULE_MAP: ReadonlyMap<string, OrbModule> = new Map(
  BUILTIN_ORB_MODULES.map((module) => [module.id, module]),
);

/**
 * Resolve a module id against an id->module map, falling back to the classic
 * built-in. This is the single fallback rule both platforms implement: a
 * theme can never reference its way into a blank orb.
 */
export function resolveOrbModule(
  id: unknown,
  modules?: ReadonlyMap<string, OrbModule> | null,
): OrbModule {
  if (isValidOrbModuleId(id)) {
    const fromMap = modules?.get(id);
    if (fromMap) return fromMap;
    const builtin = BUILTIN_ORB_MODULE_MAP.get(id);
    if (builtin) return builtin;
  }
  return CLASSIC_MODULE;
}

// ---------------------------------------------------------------------------
// Color resolution
// ---------------------------------------------------------------------------
//
// Renderers don't read the avatar theme directly; the host component builds
// an OrbPalette (one resolved rgb+alpha per theme slot) each frame and the
// renderer resolves layer color refs against it. Keeping this math here means
// the web renderer, the tvOS port, and the tests all share one definition of
// "what color does this ref produce".

/** A concrete color: 0-255 rgb channels plus a 0..1 alpha. */
export type OrbResolvedColor = { rgb: [number, number, number]; alpha: number };

/** Every theme slot resolved to a concrete color for the current frame. */
export type OrbPalette = Record<OrbThemeSlot, OrbResolvedColor>;

/** Parse #rgb or #rrggbb into an rgb tuple; invalid input yields white. */
export function hexToRgb(hex: string): [number, number, number] {
  if (!HEX_COLOR_PATTERN.test(hex)) return [255, 255, 255];
  const raw = hex.slice(1);
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Linear rgb mix used by the alert pulse (matches the old mixRgb helper). */
function mixChannel(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

/**
 * Resolve a color ref to a concrete color.
 *
 * `alertPulse` is the 0..1 alert oscillation (0 whenever the alert is
 * inactive); when the ref carries `alertTheme`, the resolved color is mixed
 * toward that slot's color by the pulse value — exactly how the classic orb's
 * outer gradient throbs toward the alert color.
 */
export function resolveOrbColor(
  ref: OrbColorRef,
  palette: OrbPalette,
  alertPulse: number,
): OrbResolvedColor {
  const base: OrbResolvedColor = ref.theme
    ? palette[ref.theme]
    : { rgb: hexToRgb(ref.hex ?? "#ffffff"), alpha: 1 };

  let rgb = base.rgb;
  let alpha = base.alpha;
  if (ref.alertTheme && alertPulse > 0) {
    const alert = palette[ref.alertTheme];
    rgb = [
      mixChannel(rgb[0], alert.rgb[0], alertPulse),
      mixChannel(rgb[1], alert.rgb[1], alertPulse),
      mixChannel(rgb[2], alert.rgb[2], alertPulse),
    ];
    alpha = alpha + (alert.alpha - alpha) * alertPulse;
  }
  if (ref.alpha !== undefined) {
    alpha *= ref.alpha;
  }
  return { rgb, alpha: clamp(alpha, 0, 1) };
}
