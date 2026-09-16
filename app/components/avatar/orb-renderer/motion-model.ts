"use client";

// Pure per-segment motion for the animated orb layers. Each function takes
// the state it mutates as an argument; the renderer owns the instances.

import type {
  OrbArcFieldLayer,
  OrbFieldColorMode,
  OrbLineFieldLayer,
  OrbRingTurbulence,
} from "../../../../lib/orb-modules";
import { orbSettingNumber } from "../../../../lib/orb-modules";
import type { FieldSegment, LineSegment, TurbulentFiber } from "./types";

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
export function createFieldSegments(layer: OrbArcFieldLayer): FieldSegment[] {
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
export function stepSegment(seg: FieldSegment, layer: OrbArcFieldLayer, load: number, tSec: number, dtSec: number) {
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

/**
 * Build the initial segment population for a lineField layer. Positions are
 * randomized so segments on the same track are desynced from the start, and
 * `nextResampleAt: 0` makes the first frame sample real motion targets —
 * the same convention as arcField.
 */
export function createLineSegments(layer: OrbLineFieldLayer): LineSegment[] {
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
export function stepLineSegment(
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

export function createTurbulentFibers(count: number): TurbulentFiber[] {
  return Array.from({ length: count }, () => ({
    phases: [Math.random(), Math.random(), Math.random()],
    drift: 0.75 + Math.random() * 0.5,
    seed: Math.random() * 1000,
  }));
}

export function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

/** Cheap deterministic 0..1 hash — the classic sin-fract noise. */
export function hashNoise(n: number) {
  const s = Math.sin(n) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Resolve a turbulence block's knobs for this frame. Fallbacks are each
 * knob's calm default, so an unbound/foreign setting ref degrades to a plain
 * breathing circle rather than dropping the layer.
 */
export function resolveTurbulenceKnobs(turbulence: OrbRingTurbulence, settings: Record<string, number> | undefined) {
  return {
    fibers: Math.round(Math.max(1, Math.min(12, orbSettingNumber(turbulence.fibers, settings, 1)))),
    chaos: clamp01(orbSettingNumber(turbulence.chaos, settings, 0) / 100),
    weave: clamp01(orbSettingNumber(turbulence.weave, settings, 30) / 100),
    speed: clamp01(orbSettingNumber(turbulence.speed, settings, 30) / 100),
    pulse: clamp01(orbSettingNumber(turbulence.pulse, settings, 0) / 100),
    softness: clamp01(orbSettingNumber(turbulence.softness, settings, 30) / 100),
  };
}
