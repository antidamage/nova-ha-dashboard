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

import {
  orbSettingNumber,
  resolveOrbColor,
  type OrbArcFieldLayer,
  type OrbArcLayer,
  type OrbBlendMode,
  type OrbColorRef,
  type OrbDiscLayer,
  type OrbFieldColorMode,
  type OrbGradientStop,
  type OrbLayer,
  type OrbLineFieldLayer,
  type OrbLineLayer,
  type OrbModule,
  type OrbPalette,
  type OrbPolygonLayer,
  type OrbResolvedColor,
  type OrbRingLayer,
  type OrbRingTurbulence,
} from "../../lib/orb-modules";

const TWO_PI = Math.PI * 2;

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

/** Map the cross-platform blend names onto canvas composite operations. */
const BLEND_TO_COMPOSITE: Record<OrbBlendMode, GlobalCompositeOperation> = {
  normal: "source-over",
  additive: "lighter",
  screen: "screen",
  multiply: "multiply",
};

/** Format a resolved color as a canvas rgba() string. */
function rgba(color: OrbResolvedColor): string {
  return `rgba(${color.rgb[0]}, ${color.rgb[1]}, ${color.rgb[2]}, ${color.alpha})`;
}

// ---------------------------------------------------------------------------
// arcField animation state
// ---------------------------------------------------------------------------

/**
 * Mutable per-segment state for one arcField layer. Angles and sweeps are in
 * turns, velocities in turns/second — converted to radians only at draw time.
 */
type FieldSegment = {
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

/**
 * Pick a segment's color index per the layer's color mode: round-robin by
 * default, or uniformly random when the module asks for it.
 */
function assignColorIndex(index: number, colorCount: number, mode: OrbFieldColorMode | undefined) {
  return mode === "random" ? Math.floor(Math.random() * colorCount) : index % colorCount;
}

/**
 * Build the initial segment population for an arcField layer. Targets start
 * at zero with `nextResampleAt: 0`, so the very first frame samples real
 * targets — mirroring the original NovaAvatar behavior.
 */
function createFieldSegments(layer: OrbArcFieldLayer): FieldSegment[] {
  const ringCount = Math.max(1, layer.ringCount ?? 3);
  return Array.from({ length: layer.count }, (_, i) => {
    // Position within the radial band: either an even spread or snapped to
    // one of N concentric rings, with optional jitter either way.
    const spreadT = layer.count > 1 ? i / (layer.count - 1) : 0.5;
    const ringT = ringCount > 1 ? (i % ringCount) / (ringCount - 1) : 0.5;
    const t = layer.distribution === "rings" ? ringT : spreadT;
    const jitter = (Math.random() - 0.5) * (layer.ringJitter ?? 0);
    const baseRadius = Math.max(
      layer.radiusMin,
      Math.min(layer.radiusMax, layer.radiusMin + t * (layer.radiusMax - layer.radiusMin) + jitter),
    );
    return {
      colorIndex: assignColorIndex(i, layer.colors.length, layer.colorMode),
      baseRadius,
      width: layer.widthMin + Math.random() * (layer.widthMax - layer.widthMin),
      angle: Math.random(),
      angularVel: 0,
      targetVel: 0,
      sweep: 0,
      targetSweep: 0,
      nextResampleAt: 0,
    };
  });
}

/**
 * Advance one segment by dt seconds: resample targets when due (scaled by
 * load), then ease sweep and angular velocity toward them and integrate the
 * angle. This is the exact motion model of the original orb, generalized to
 * module-supplied constants.
 */
function stepSegment(seg: FieldSegment, layer: OrbArcFieldLayer, load: number, tSec: number, dtSec: number) {
  if (tSec >= seg.nextResampleAt) {
    // Sweep target: a random idle length, stretched toward loadSweep by load.
    const idle = layer.idleSweepMin + Math.random() * (layer.idleSweepMax - layer.idleSweepMin);
    seg.targetSweep = idle + (layer.loadSweep - idle) * load;
    // Speed target: random base speed plus a load bonus, random direction.
    const speed = layer.speedMin + Math.random() * (layer.speedMax - layer.speedMin) + load * layer.loadSpeed;
    seg.targetVel = (Math.random() < 0.5 ? -1 : 1) * speed;
    seg.nextResampleAt = tSec + (layer.resampleMin ?? 0.8) + Math.random() * (layer.resampleJitter ?? 0.6);
  }

  const sweepEase = layer.sweepEase ?? 1;
  const velocityEase = layer.velocityEase ?? 1;
  seg.sweep += (seg.targetSweep - seg.sweep) * Math.min(1, dtSec * sweepEase);
  seg.angularVel += (seg.targetVel - seg.angularVel) * Math.min(1, dtSec * velocityEase);
  seg.angle += seg.angularVel * dtSec;
}

// ---------------------------------------------------------------------------
// lineField animation state
// ---------------------------------------------------------------------------

/**
 * Mutable per-segment state for one lineField layer. `pos` is the segment's
 * CENTER as a fraction of its track (0 = track start, 1 = track end);
 * `length` is the segment length as a fraction of the track; velocities are
 * track-lengths/second, negative when heading back toward the start.
 */
type LineSegment = {
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

/**
 * Build the initial segment population for a lineField layer. Positions are
 * randomized so segments on the same track are desynced from the start, and
 * `nextResampleAt: 0` makes the first frame sample real motion targets —
 * the same convention as arcField.
 */
function createLineSegments(layer: OrbLineFieldLayer): LineSegment[] {
  return Array.from({ length: layer.count }, (_, i) => ({
    // Round-robin across tracks: with two tracks (e.g. the bars of an X),
    // half the segments ride one diagonal and half the other.
    trackIndex: i % layer.tracks.length,
    colorIndex: assignColorIndex(i, layer.colors.length, layer.colorMode),
    width: layer.widthMin + Math.random() * (layer.widthMax - layer.widthMin),
    pos: Math.random(),
    vel: 0,
    targetVel: 0,
    length: 0,
    targetLength: 0,
    nextResampleAt: 0,
  }));
}

/**
 * Advance one lineField segment by dt seconds:
 *   1. When the resample deadline passes, pick a new target length (random
 *      idle length stretched toward `loadLength` by the current load) and a
 *      new target velocity (random base speed plus a load bonus, in a RANDOM
 *      direction — this is the "randomly reverse along the path" behavior).
 *   2. Ease length and velocity toward their targets (all movement lerps).
 *   3. Integrate the position and bounce off the track ends, keeping the
 *      whole segment inside the track bounds.
 */
function stepLineSegment(
  seg: LineSegment,
  layer: OrbLineFieldLayer,
  load: number,
  tSec: number,
  dtSec: number,
) {
  if (tSec >= seg.nextResampleAt) {
    const idle = layer.idleLengthMin + Math.random() * (layer.idleLengthMax - layer.idleLengthMin);
    seg.targetLength = Math.min(1, idle + (layer.loadLength - idle) * load);
    const speed = layer.speedMin + Math.random() * (layer.speedMax - layer.speedMin) + load * layer.loadSpeed;
    seg.targetVel = (Math.random() < 0.5 ? -1 : 1) * speed;
    seg.nextResampleAt = tSec + (layer.resampleMin ?? 0.8) + Math.random() * (layer.resampleJitter ?? 0.6);
  }

  const lengthEase = layer.lengthEase ?? 1;
  const velocityEase = layer.velocityEase ?? 1;
  seg.length += (seg.targetLength - seg.length) * Math.min(1, dtSec * lengthEase);
  seg.vel += (seg.targetVel - seg.vel) * Math.min(1, dtSec * velocityEase);
  seg.pos += seg.vel * dtSec;

  // Bounce: the segment spans [pos - length/2, pos + length/2] and must stay
  // inside [0, 1]. Hitting an end reflects both the live velocity and the
  // target so the segment heads back without fighting the easing.
  const half = seg.length / 2;
  const minPos = half;
  const maxPos = 1 - half;
  if (minPos >= maxPos) {
    // Segment fills (or overfills) the track — pin it centered.
    seg.pos = 0.5;
    return;
  }
  if (seg.pos > maxPos) {
    seg.pos = maxPos;
    seg.vel = -Math.abs(seg.vel);
    seg.targetVel = -Math.abs(seg.targetVel);
  } else if (seg.pos < minPos) {
    seg.pos = minPos;
    seg.vel = Math.abs(seg.vel);
    seg.targetVel = Math.abs(seg.targetVel);
  }
}

// ---------------------------------------------------------------------------
// Layer drawing
// ---------------------------------------------------------------------------

/** Convert a unit-space x/y to canvas pixels for the current frame. */
function px(frame: OrbFrame, v: number) {
  return v * frame.radiusPx;
}

/**
 * Build a canvas gradient from module stops. Colors are resolved against the
 * frame palette so theme edits and alert pulses apply immediately.
 */
function buildStops(
  gradient: CanvasGradient,
  stops: OrbGradientStop[],
  palette: OrbPalette,
  alertPulse: number,
) {
  for (const stop of stops) {
    gradient.addColorStop(stop.at, rgba(resolveOrbColor(stop.color, palette, alertPulse)));
  }
}

/** Pick the stop with the strongest alpha — used as the glow color for gradient strokes. */
function brightestStop(stops: OrbGradientStop[], palette: OrbPalette, alertPulse: number): OrbResolvedColor {
  let best = resolveOrbColor(stops[0].color, palette, alertPulse);
  for (const stop of stops.slice(1)) {
    const resolved = resolveOrbColor(stop.color, palette, alertPulse);
    if (resolved.alpha > best.alpha) best = resolved;
  }
  return best;
}

function drawDisc(ctx: CanvasRenderingContext2D, layer: OrbDiscLayer, frame: OrbFrame, alertPulse: number) {
  const center = layer.center ?? { x: 0, y: 0 };
  const radius = layer.radius ?? 1;
  const cx = frame.centerX + px(frame, center.x);
  const cy = frame.centerY + px(frame, center.y);
  const rx = px(frame, radius);
  const ry = rx * (layer.scaleY ?? 1);

  if (layer.stops.length === 1) {
    // Single stop: plain solid fill, no gradient allocation.
    ctx.fillStyle = rgba(resolveOrbColor(layer.stops[0].color, frame.palette, alertPulse));
  } else {
    // Radial gradient between the module's focus circles (defaults trace a
    // plain center-out gradient). The gradient is circular in unit space even
    // for elliptical discs — matching the original cap-highlight drawing.
    const from = layer.gradientFrom ?? { ...center, radius: 0 };
    const to = layer.gradientTo ?? { ...center, radius };
    const gradient = ctx.createRadialGradient(
      frame.centerX + px(frame, from.x),
      frame.centerY + px(frame, from.y),
      px(frame, from.radius),
      frame.centerX + px(frame, to.x),
      frame.centerY + px(frame, to.y),
      px(frame, to.radius),
    );
    buildStops(gradient, layer.stops, frame.palette, alertPulse);
    ctx.fillStyle = gradient;
  }

  if (layer.glow) {
    const glowColor = brightestStop(layer.stops, frame.palette, alertPulse);
    ctx.shadowBlur = px(frame, layer.glow);
    ctx.shadowColor = rgba(glowColor);
  }

  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, (layer.rotation ?? 0) * TWO_PI, 0, TWO_PI);
  ctx.fill();
}

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
type TurbulentFiber = {
  phases: [number, number, number];
  drift: number;
  seed: number;
};

function createTurbulentFibers(count: number): TurbulentFiber[] {
  return Array.from({ length: count }, () => ({
    phases: [Math.random(), Math.random(), Math.random()],
    drift: 0.75 + Math.random() * 0.5,
    seed: Math.random() * 1000,
  }));
}

/** Samples per strand loop. Sine octaves use whole cycle counts so the path closes seamlessly. */
const TURBULENCE_SAMPLES = 96;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

/** Cheap deterministic 0..1 hash — the classic sin-fract noise. */
function hashNoise(n: number) {
  const s = Math.sin(n) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Resolve a turbulence block's knobs for this frame. Fallbacks are each
 * knob's calm default, so an unbound/foreign setting ref degrades to a plain
 * breathing circle rather than dropping the layer.
 */
function resolveTurbulenceKnobs(turbulence: OrbRingTurbulence, settings: Record<string, number> | undefined) {
  return {
    fibers: Math.round(Math.max(1, Math.min(12, orbSettingNumber(turbulence.fibers, settings, 1)))),
    chaos: clamp01(orbSettingNumber(turbulence.chaos, settings, 0) / 100),
    weave: clamp01(orbSettingNumber(turbulence.weave, settings, 30) / 100),
    speed: clamp01(orbSettingNumber(turbulence.speed, settings, 30) / 100),
    pulse: clamp01(orbSettingNumber(turbulence.pulse, settings, 0) / 100),
    softness: clamp01(orbSettingNumber(turbulence.softness, settings, 30) / 100),
  };
}

/**
 * Draw a ring distorted by its turbulence knobs: each strand is a closed
 * loop of TURBULENCE_SAMPLES points whose radius is perturbed by three
 * drifting sine octaves (chaos shifts energy into the higher octaves) plus a
 * flickering per-sample hash jitter at high chaos — the "lightning" crackle.
 * Pulse breathes the base radius; softness trades sharp bright cores for
 * wider glow.
 */
function drawTurbulentRing(
  ctx: CanvasRenderingContext2D,
  layer: OrbRingLayer,
  knobs: ReturnType<typeof resolveTurbulenceKnobs>,
  fibers: TurbulentFiber[],
  frame: OrbFrame,
  alertPulse: number,
) {
  const { chaos, weave, speed, pulse, softness } = knobs;
  const color = resolveOrbColor(layer.color, frame.palette, alertPulse);
  const tSec = frame.nowMs / 1000;

  // Radius breathing — the "perfect, gentle pulsating circle" base behaviour.
  const breath = 1 + pulse * 0.05 * Math.sin(tSec * (0.12 + speed * 0.55) * TWO_PI);
  // Organic noise amplitude (unit space) and the flickering crackle on top.
  const amp = chaos * (0.035 + 0.1 * chaos);
  const crackleAmp = chaos * chaos * 0.05;
  // Crackle re-rolls at a speed-scaled tick so lightning strands visibly jump.
  const crackleTick = Math.floor(tSec * (4 + speed * 16));
  const driftBase = 0.02 + speed * 0.22;

  // Split the stroke mass across strands; soften mellows the core alpha while
  // widening the glow, so "softness" reads as diffuse rather than dim.
  const strandWidth = Math.max(0.5, px(frame, layer.width) / Math.sqrt(fibers.length));
  const strandAlpha = clamp01(color.alpha * (1 - 0.35 * softness));
  const glowUnits = (layer.glow ?? 0) * (0.4 + 1.6 * softness);
  const strokeStyle = rgba({ rgb: color.rgb, alpha: strandAlpha });

  ctx.lineWidth = strandWidth;
  ctx.lineJoin = "round";
  ctx.strokeStyle = strokeStyle;
  if (glowUnits > 0) {
    ctx.shadowBlur = px(frame, glowUnits);
    ctx.shadowColor = rgba(color);
  }

  for (const fiber of fibers) {
    ctx.beginPath();
    for (let k = 0; k <= TURBULENCE_SAMPLES; k += 1) {
      const theta = k / TURBULENCE_SAMPLES;
      // Whole cycle counts (3/7/13) keep each octave continuous across the
      // loop seam; weave scales how far apart the strands' phases sit.
      const p0 = (theta * 3 + fiber.phases[0] * weave + tSec * driftBase * fiber.drift) * TWO_PI;
      const p1 = (theta * 7 - fiber.phases[1] * weave * 2 - tSec * driftBase * 1.7 * fiber.drift) * TWO_PI;
      const p2 = (theta * 13 + fiber.phases[2] * weave * 3 + tSec * driftBase * 2.6) * TWO_PI;
      const organic =
        Math.sin(p0) * 0.55 +
        Math.sin(p1) * 0.3 +
        Math.sin(p2) * 0.15 * (0.5 + chaos);
      // Hash on k modulo the sample count so the seam sample matches sample 0.
      const jitter = crackleAmp > 0
        ? (hashNoise((k % TURBULENCE_SAMPLES) * 12.9898 + fiber.seed * 78.233 + crackleTick * 37.719) - 0.5) * 2
        : 0;
      const radius = layer.radius * breath + amp * organic + crackleAmp * jitter;

      const angle = theta * TWO_PI;
      const r = px(frame, radius);
      const x = frame.centerX + Math.cos(angle) * r;
      const y = frame.centerY + Math.sin(angle) * r;
      if (k === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  layer: OrbRingLayer,
  frame: OrbFrame,
  alertPulse: number,
  fiberStore?: Map<number, TurbulentFiber[]>,
  layerIndex?: number,
) {
  const turbulence = layer.turbulence;
  if (turbulence && fiberStore !== undefined && layerIndex !== undefined) {
    const knobs = resolveTurbulenceKnobs(turbulence, frame.settings);
    // Anything to distort? Otherwise fall through to the plain ctx.arc path
    // below so untouched rings stay pixel-identical to the pre-turbulence
    // renderer (a sampled polygon is visibly faceted under glow).
    if (knobs.fibers > 1 || knobs.chaos > 0 || knobs.pulse > 0) {
      // Strand state is keyed by layer index and lazily resized: the renderer
      // is only rebuilt on module change, but the fibre slider changes count
      // between frames. Existing strands keep their identity.
      let fibers = fiberStore.get(layerIndex) ?? [];
      if (fibers.length !== knobs.fibers) {
        fibers = fibers.length > knobs.fibers
          ? fibers.slice(0, knobs.fibers)
          : [...fibers, ...createTurbulentFibers(knobs.fibers - fibers.length)];
        fiberStore.set(layerIndex, fibers);
      }
      drawTurbulentRing(ctx, layer, knobs, fibers, frame, alertPulse);
      return;
    }
  }

  const color = rgba(resolveOrbColor(layer.color, frame.palette, alertPulse));
  ctx.beginPath();
  ctx.arc(frame.centerX, frame.centerY, px(frame, layer.radius), 0, TWO_PI);
  ctx.lineWidth = px(frame, layer.width);
  ctx.strokeStyle = color;
  if (layer.glow) {
    ctx.shadowBlur = px(frame, layer.glow);
    ctx.shadowColor = color;
  }
  ctx.stroke();
}

function drawArc(ctx: CanvasRenderingContext2D, layer: OrbArcLayer, frame: OrbFrame, alertPulse: number) {
  const startRad = layer.from * TWO_PI;
  const endRad = layer.to * TWO_PI;
  const r = px(frame, layer.radius);

  // Gradient runs along the chord between the arc's endpoints (reversed when
  // requested) so the stroke brightness tapers along the sweep.
  const ax = frame.centerX + Math.cos(startRad) * r;
  const ay = frame.centerY + Math.sin(startRad) * r;
  const bx = frame.centerX + Math.cos(endRad) * r;
  const by = frame.centerY + Math.sin(endRad) * r;
  const gradient = layer.reverse
    ? ctx.createLinearGradient(bx, by, ax, ay)
    : ctx.createLinearGradient(ax, ay, bx, by);
  buildStops(gradient, layer.stops, frame.palette, alertPulse);

  ctx.strokeStyle = gradient;
  ctx.lineWidth = px(frame, layer.width);
  ctx.lineCap = layer.cap ?? "round";
  if (layer.glow) {
    ctx.shadowBlur = px(frame, layer.glow);
    ctx.shadowColor = rgba(brightestStop(layer.stops, frame.palette, alertPulse));
  }
  ctx.beginPath();
  ctx.arc(frame.centerX, frame.centerY, r, startRad, endRad);
  ctx.stroke();
}

function drawArcField(
  ctx: CanvasRenderingContext2D,
  layer: OrbArcFieldLayer,
  segments: FieldSegment[],
  frame: OrbFrame,
  alertPulse: number,
) {
  const tSec = frame.nowMs / 1000;
  ctx.lineCap = layer.cap ?? "round";

  for (const seg of segments) {
    stepSegment(seg, layer, frame.load, tSec, frame.dtSec);

    const color = rgba(resolveOrbColor(layer.colors[seg.colorIndex], frame.palette, alertPulse));
    const startRad = seg.angle * TWO_PI;
    const endRad = startRad + seg.sweep * TWO_PI;

    ctx.beginPath();
    ctx.arc(frame.centerX, frame.centerY, px(frame, seg.baseRadius), startRad, endRad);
    ctx.lineWidth = px(frame, seg.width);
    ctx.strokeStyle = color;
    if (layer.glow) {
      // Each segment glows in its own color, like the original orb's arcs.
      ctx.shadowBlur = px(frame, layer.glow);
      ctx.shadowColor = color;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

function drawLine(ctx: CanvasRenderingContext2D, layer: OrbLineLayer, frame: OrbFrame, alertPulse: number) {
  const color = rgba(resolveOrbColor(layer.color, frame.palette, alertPulse));
  ctx.strokeStyle = color;
  ctx.lineWidth = px(frame, layer.width);
  ctx.lineCap = layer.cap ?? "round";
  if (layer.glow) {
    ctx.shadowBlur = px(frame, layer.glow);
    ctx.shadowColor = color;
  }
  ctx.beginPath();
  ctx.moveTo(frame.centerX + px(frame, layer.from.x), frame.centerY + px(frame, layer.from.y));
  ctx.lineTo(frame.centerX + px(frame, layer.to.x), frame.centerY + px(frame, layer.to.y));
  ctx.stroke();
}

function drawPolygon(ctx: CanvasRenderingContext2D, layer: OrbPolygonLayer, frame: OrbFrame, alertPulse: number) {
  const color = rgba(resolveOrbColor(layer.color, frame.palette, alertPulse));
  ctx.beginPath();
  layer.points.forEach((point, index) => {
    const x = frame.centerX + px(frame, point.x);
    const y = frame.centerY + px(frame, point.y);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  if (layer.close !== false) {
    ctx.closePath();
  }
  if (layer.glow) {
    ctx.shadowBlur = px(frame, layer.glow);
    ctx.shadowColor = color;
  }
  if (layer.fill) {
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = px(frame, layer.width ?? 0.02);
    ctx.stroke();
  }
}

function drawLineField(
  ctx: CanvasRenderingContext2D,
  layer: OrbLineFieldLayer,
  segments: LineSegment[],
  frame: OrbFrame,
  alertPulse: number,
) {
  const tSec = frame.nowMs / 1000;
  ctx.lineCap = layer.cap ?? "round";

  for (const seg of segments) {
    stepLineSegment(seg, layer, frame.load, tSec, frame.dtSec);

    // Convert the segment's [pos - len/2, pos + len/2] track span into the
    // two endpoint pixels by lerping along its track.
    const track = layer.tracks[seg.trackIndex];
    const t0 = seg.pos - seg.length / 2;
    const t1 = seg.pos + seg.length / 2;
    const ax = frame.centerX + px(frame, track.from.x + (track.to.x - track.from.x) * t0);
    const ay = frame.centerY + px(frame, track.from.y + (track.to.y - track.from.y) * t0);
    const bx = frame.centerX + px(frame, track.from.x + (track.to.x - track.from.x) * t1);
    const by = frame.centerY + px(frame, track.from.y + (track.to.y - track.from.y) * t1);

    const color = rgba(resolveOrbColor(layer.colors[seg.colorIndex], frame.palette, alertPulse));
    ctx.strokeStyle = color;
    ctx.lineWidth = px(frame, seg.width);
    if (layer.glow) {
      // Each segment glows in its own color, matching arcField behavior.
      ctx.shadowBlur = px(frame, layer.glow);
      ctx.shadowColor = color;
    }
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export type OrbRenderer = {
  /** The normalized module this renderer was built for. */
  module: OrbModule;
  /** Draw one frame. The caller is responsible for clearing the canvas. */
  render: (ctx: CanvasRenderingContext2D, frame: OrbFrame) => void;
};

/**
 * Build a renderer instance for a module. ArcField segment state is allocated
 * here, keyed by layer index, so each mounted orb animates independently and
 * a module change (new renderer) restarts the animation from scratch.
 */
export function createOrbRenderer(module: OrbModule): OrbRenderer {
  // Pre-allocate animation state for every animated layer, keyed by layer
  // index so duplicate layer types stay independent. Turbulent-ring strand
  // state is allocated lazily inside drawRing because its count is a live
  // setting, not a module constant.
  const fieldState = new Map<number, FieldSegment[]>();
  const lineState = new Map<number, LineSegment[]>();
  const ringFiberState = new Map<number, TurbulentFiber[]>();
  module.layers.forEach((layer, index) => {
    if (layer.type === "arcField") {
      fieldState.set(index, createFieldSegments(layer));
    } else if (layer.type === "lineField") {
      lineState.set(index, createLineSegments(layer));
    }
  });

  const render = (ctx: CanvasRenderingContext2D, frame: OrbFrame) => {
    // One shared alert oscillation per frame: 0 when inactive, otherwise a
    // raised-cosine 0..1 wave over the module's alertPulsePeriod. Drives both
    // alertTheme color mixing and alertOnly layer pulses. A frame-supplied
    // override (the voice agent's consonant envelope) replaces the wave so
    // speech pulses reuse the exact gym-alert colour path.
    const alertPulse = frame.alertPulseOverride !== undefined
      ? Math.max(0, Math.min(1, frame.alertPulseOverride))
      : frame.alertActive
        ? (1 - Math.cos((frame.nowMs / (module.alertPulsePeriod * 1000)) * TWO_PI)) / 2
        : 0;

    module.layers.forEach((layer: OrbLayer, index: number) => {
      if (layer.enabled === false) return;

      // Layer opacity = static opacity x pulse wave. alertOnly layers do not
      // render at all while the alert is inactive.
      let opacity = layer.opacity ?? 1;
      if (layer.pulse) {
        if (layer.pulse.alertOnly && !frame.alertActive) return;
        // Alert-only layers follow the consonant envelope during speech so
        // every part of the alert animation beats to the same rhythm.
        const wave = layer.pulse.alertOnly && frame.alertPulseOverride !== undefined
          ? Math.max(0, Math.min(1, frame.alertPulseOverride))
          : (1 - Math.cos((frame.nowMs / (layer.pulse.period * 1000)) * TWO_PI)) / 2;
        opacity *= layer.pulse.min + (layer.pulse.max - layer.pulse.min) * wave;
      }
      if (opacity <= 0) return;

      ctx.save();
      ctx.globalCompositeOperation = BLEND_TO_COMPOSITE[layer.blend ?? "normal"];
      ctx.globalAlpha = opacity;
      ctx.shadowBlur = 0;
      if (layer.clip) {
        // Confine the layer to the orb's interior so gradients and glows
        // cannot spill past the rim (the glass gloss stack relies on this).
        ctx.beginPath();
        ctx.arc(frame.centerX, frame.centerY, frame.radiusPx, 0, TWO_PI);
        ctx.clip();
      }

      if (layer.type === "disc") {
        drawDisc(ctx, layer, frame, alertPulse);
      } else if (layer.type === "ring") {
        drawRing(ctx, layer, frame, alertPulse, ringFiberState, index);
      } else if (layer.type === "arc") {
        drawArc(ctx, layer, frame, alertPulse);
      } else if (layer.type === "arcField") {
        drawArcField(ctx, layer, fieldState.get(index) ?? [], frame, alertPulse);
      } else if (layer.type === "line") {
        drawLine(ctx, layer, frame, alertPulse);
      } else if (layer.type === "polygon") {
        drawPolygon(ctx, layer, frame, alertPulse);
      } else if (layer.type === "lineField") {
        drawLineField(ctx, layer, lineState.get(index) ?? [], frame, alertPulse);
      }

      ctx.restore();
    });
  };

  return { module, render };
}

/** Re-export the color ref type for components that build custom palettes. */
export type { OrbColorRef };
