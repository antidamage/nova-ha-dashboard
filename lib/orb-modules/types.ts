// Status Orb module format: the building-block types layers share. The
// layer kinds, the OrbLayer union and OrbModule are in ./layer-types.

import type { ORB_BLEND_MODES, ORB_THEME_SLOTS } from "./constants";

// ---------------------------------------------------------------------------
// Color references
// ---------------------------------------------------------------------------

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

/**
 * A visibility gate bound to one of the module's declared settings: the layer
 * draws only while that setting sits inside [min, max] (either end omitted =
 * unbounded). It is how a module ships two alternative treatments of the same
 * surface — the Tech skin's light and dark knob — and lets one checkbox-shaped
 * setting choose between them.
 *
 * A gate naming a setting the frame does not carry evaluates against 0, so a
 * settingless render (a static swatch preview) still picks exactly one side.
 */
export type OrbLayerGate = {
  /** Declared setting id, same charset as module ids. */
  setting: string;
  /** Inclusive lower bound; omitted = unbounded. */
  min?: number;
  /** Inclusive upper bound; omitted = unbounded. */
  max?: number;
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
  /** Optional setting-bound visibility gate (see OrbLayerGate). */
  enabledWhen?: OrbLayerGate;
};

/** A point in orb unit space (orb radius = 1, center = 0,0, +y down). */
export type OrbPoint = { x: number; y: number };

/** A radial-gradient focus circle: center plus radius, all in unit space. */
export type OrbGradientCircle = OrbPoint & { radius: number };

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

/** A CSS-style linear gradient across the orb's box. */
export type OrbLinearGradient = {
  /** CSS degrees: 0 points up the orb, 90 to its right. */
  angle: number;
  stops: OrbGradientStop[];
};

export type OrbInnerShadow = {
  /** Blur radius in unit space (the CSS blur over the orb's radius). */
  blur: number;
  color: OrbColorRef;
};

/**
 * How animated field layers assign colors to their segments:
 *   "cycle"  - round-robin through `colors` (segment i uses colors[i % n]),
 *              the default and the original arcField behavior.
 *   "random" - each segment picks one of `colors` at random on creation.
 */
export type OrbFieldColorMode = "cycle" | "random";

/** A straight path an animated lineField segment travels along. */
export type OrbTrack = {
  from: OrbPoint;
  to: OrbPoint;
};

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
