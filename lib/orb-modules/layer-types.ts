// Status Orb module format: the layer kinds, the OrbLayer union, and the
// module document that stacks them. Shared building blocks are in ./types.

import type {
  OrbColorRef,
  OrbFieldColorMode,
  OrbGradientCircle,
  OrbGradientStop,
  OrbInnerShadow,
  OrbLayerBase,
  OrbLinearGradient,
  OrbModuleSettingDecl,
  OrbPoint,
  OrbRingTurbulence,
  OrbTrack,
} from "./types";

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
  /**
   * Paints the band with a linear gradient laid across the whole orb instead
   * of a flat colour, exactly as a CSS `linear-gradient(<angle>deg, ...)` over
   * the element would — `angle` in CSS degrees (0 points up, clockwise), stop
   * offsets 0..1 along the gradient line. `color` is ignored when this is set.
   * This is what lets an orb reproduce the knob's sunken colour channel
   * (`.rotary-encoder-ring-shade`) rather than approximating it with arcs.
   */
  gradient?: OrbLinearGradient;
  /**
   * A CSS `inset 0 0 <blur> <color>` shadow inside the band: both walls of the
   * well, blurred inwards. `blur` is in unit space, like every other radius.
   */
  innerShadow?: OrbInnerShadow;
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
