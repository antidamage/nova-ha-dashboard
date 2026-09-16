// Status Orb module format: layer normalization. normalizeOrbLayer keeps its
// geometry, base-field and turbulence helpers beside it; moving them out would
// add five exports whose only caller is normalizeOrbLayer.

import { ORB_BLEND_MODES } from "./constants";
import type {
  OrbBlendMode,
  OrbGradientCircle,
  OrbLayerBase,
  OrbLayerGate,
  OrbLayerPulse,
  OrbPoint,
  OrbRingTurbulence,
  OrbSettingValue,
  OrbTrack,
} from "./types";
import type {
  OrbArcFieldLayer,
  OrbArcLayer,
  OrbDiscLayer,
  OrbLayer,
  OrbLineFieldLayer,
  OrbLineLayer,
  OrbPolygonLayer,
  OrbRingLayer,
} from "./layer-types";
import { clampedNum, isValidOrbModuleId, recordValue } from "./value-model";
import {
  normalizeInnerShadow,
  normalizeLinearGradient,
  normalizeOrbColorRef,
  normalizeStops,
} from "./paint-model";

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
  const gate = normalizeGate(v.enabledWhen);
  if (gate) base.enabledWhen = gate;
  return base;
}

/** Normalize a layer visibility gate; undefined when it names no valid setting. */
function normalizeGate(value: unknown): OrbLayerGate | undefined {
  const v = recordValue(value);
  if (!v || !isValidOrbModuleId(v.setting)) return undefined;
  const gate: OrbLayerGate = { setting: v.setting };
  if (Number.isFinite(Number(v.min))) gate.min = Number(v.min);
  if (Number.isFinite(Number(v.max))) gate.max = Number(v.max);
  return gate;
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
    const gradient = normalizeLinearGradient(v.gradient);
    if (gradient) layer.gradient = gradient;
    const innerShadow = normalizeInnerShadow(v.innerShadow);
    if (innerShadow) layer.innerShadow = innerShadow;
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
