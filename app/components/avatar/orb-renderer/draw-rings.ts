"use client";

// Ring painter: plain, gradient, inner-shadowed and turbulent rings.

import {
  resolveOrbColor,
  type OrbLinearGradient,
  type OrbRingLayer,
} from "../../../../lib/orb-modules";
import { TURBULENCE_SAMPLES, TWO_PI } from "./constants";
import { buildStops, px, rgba } from "./draw-shapes";
import { clamp01, createTurbulentFibers, hashNoise, resolveTurbulenceKnobs } from "./motion-model";
import type { OrbFrame, TurbulentFiber } from "./types";

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

/**
 * A CSS `linear-gradient(<angle>deg, ...)` over the orb's box, as a canvas
 * gradient. CSS measures the angle clockwise from straight up and sizes the
 * gradient line so the stops land where they do on the element: for a square
 * of side D the line is D(|sin a| + |cos a|) long through the centre.
 */
function cssLinearGradient(
  ctx: CanvasRenderingContext2D,
  frame: OrbFrame,
  gradient: OrbLinearGradient,
  alertPulse: number,
) {
  const radians = (gradient.angle * Math.PI) / 180;
  // Screen space: y grows downward, so "up" is -cos.
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const side = frame.radiusPx * 2;
  const half = (side * (Math.abs(dx) + Math.abs(dy))) / 2;
  const paint = ctx.createLinearGradient(
    frame.centerX - dx * half,
    frame.centerY - dy * half,
    frame.centerX + dx * half,
    frame.centerY + dy * half,
  );
  buildStops(paint, gradient.stops, frame.palette, alertPulse);
  return paint;
}

/**
 * A CSS `inset 0 0 <blur>` shadow inside a band. Both walls are stroked with a
 * band lying wholly outside the clip, so only the blur that bleeds inwards
 * survives — the same trick a browser uses for an inset shadow, and the reason
 * it reads as a well rather than as two drawn-on lines.
 */
function drawRingInnerShadow(
  ctx: CanvasRenderingContext2D,
  layer: OrbRingLayer,
  frame: OrbFrame,
  alertPulse: number,
) {
  const shadow = layer.innerShadow;
  if (!shadow) return;
  const radius = px(frame, layer.radius);
  const halfWidth = px(frame, layer.width) / 2;
  const blur = px(frame, shadow.blur);
  if (blur <= 0) return;
  const color = rgba(resolveOrbColor(shadow.color, frame.palette, alertPulse));

  ctx.save();
  // Clip to the band: outer disc minus inner disc, as one even-odd path.
  ctx.beginPath();
  ctx.arc(frame.centerX, frame.centerY, radius + halfWidth, 0, TWO_PI);
  ctx.arc(frame.centerX, frame.centerY, Math.max(0, radius - halfWidth), 0, TWO_PI);
  ctx.clip("evenodd");
  ctx.shadowBlur = blur;
  ctx.shadowColor = color;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = blur * 2;
  for (const wall of [radius + halfWidth + blur, radius - halfWidth - blur]) {
    if (wall <= 0) continue;
    ctx.beginPath();
    ctx.arc(frame.centerX, frame.centerY, wall, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawRing(
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
  ctx.strokeStyle = layer.gradient
    ? cssLinearGradient(ctx, frame, layer.gradient, alertPulse)
    : color;
  if (layer.glow) {
    ctx.shadowBlur = px(frame, layer.glow);
    ctx.shadowColor = color;
  }
  ctx.stroke();
  drawRingInnerShadow(ctx, layer, frame, alertPulse);
}
