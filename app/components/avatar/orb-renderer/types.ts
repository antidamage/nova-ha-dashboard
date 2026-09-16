"use client";

// Types for the canvas orb renderer (app/components/orbRenderer.ts).

import type {
  OrbColorRef,
  OrbModule,
  OrbPalette,
} from "../../../../lib/orb-modules";

/** Everything the renderer needs for one frame. */
export type OrbFrame = {
  /** Orb center in canvas CSS pixels. */
  centerX: number;
  centerY: number;
  /** Orb radius in canvas CSS pixels (unit 1.0 in module space). */
  radiusPx: number;
  /** Theme slots resolved for this frame (see buildOrbPalette). */
  palette: OrbPalette;
  /** Composite host load 0..1 driving arcField sweep/speed. */
  load: number;
  /** Whether the gym alert is currently active (drives pulses + alert mixes). */
  alertActive: boolean;
  /**
   * When set, replaces the module's time-based alert oscillation with an
   * externally computed 0..1 pulse (the voice agent's consonant envelope).
   * The caller must also set alertActive so alertOnly layers render.
   */
  alertPulseOverride?: number;
  /**
   * Multiplies every alert period this frame — the module's own
   * `alertPulsePeriod` and any `alertOnly` layer pulse — so one theme-level
   * slider sets the alert's cadence across whichever module is on
   * (`alertPulseScale` in avatarThemeModel.ts). Above 1 is slower, below 1
   * faster. Absent or non-finite leaves every period as declared.
   */
  alertPulseScale?: number;
  /** Monotonic time in milliseconds (performance.now()). */
  nowMs: number;
  /** Seconds since the previous frame, already clamped by the caller. */
  dtSec: number;
  /**
   * The module's resolved setting values for this frame (declared defaults
   * overlaid with the user's saved sliders — see resolveOrbModuleSettings).
   * Optional: layers with setting-bound parameters fall back to their
   * built-in defaults when absent (e.g. static swatch previews).
   */
  settings?: Record<string, number>;
};

// ---------------------------------------------------------------------------
// arcField animation state
// ---------------------------------------------------------------------------

/**
 * Mutable per-segment state for one arcField layer. Angles and sweeps are in
 * turns, velocities in turns/second — converted to radians only at draw time.
 */
export type FieldSegment = {
  /** Index into the layer's colors array (assigned round-robin). */
  colorIndex: number;
  /** Resting radius in unit space (band position + jitter). */
  baseRadius: number;
  /** Stroke width in unit space, sampled once at creation. */
  width: number;
  angle: number;
  angularVel: number;
  targetVel: number;
  sweep: number;
  targetSweep: number;
  /** Layer-time (seconds) at which to resample targets. */
  nextResampleAt: number;
};

// ---------------------------------------------------------------------------
// lineField animation state
// ---------------------------------------------------------------------------

/**
 * Mutable per-segment state for one lineField layer. `pos` is the segment's
 * CENTER as a fraction of its track (0 = track start, 1 = track end);
 * `length` is the segment length as a fraction of the track; velocities are
 * track-lengths/second, negative when heading back toward the start.
 */
export type LineSegment = {
  /** Index into the layer's tracks array (assigned round-robin). */
  trackIndex: number;
  /** Index into the layer's colors array (assigned per colorMode). */
  colorIndex: number;
  /** Stroke width in unit space, sampled once at creation. */
  width: number;
  pos: number;
  vel: number;
  targetVel: number;
  length: number;
  targetLength: number;
  /** Layer-time (seconds) at which to resample targets. */
  nextResampleAt: number;
};

// ---------------------------------------------------------------------------
// Turbulent ring (OrbRingTurbulence) animation state
// ---------------------------------------------------------------------------

/**
 * Per-strand random identity for a turbulent ring, sampled once so the
 * strands stay coherent frame-to-frame. Phases offset the three noise
 * octaves (scaled by the weave knob, so weave 0 collapses every strand onto
 * the same path), drift desyncs their travel speed, and seed feeds the
 * high-chaos crackle hash.
 */
export type TurbulentFiber = {
  phases: [number, number, number];
  drift: number;
  seed: number;
};

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export type OrbRenderer = {
  /** The normalized module this renderer was built for. */
  module: OrbModule;
  /** Draw one frame. The caller is responsible for clearing the canvas. */
  render: (ctx: CanvasRenderingContext2D, frame: OrbFrame) => void;
};

/** Re-export the color ref type for components that build custom palettes. */
export type { OrbColorRef };
