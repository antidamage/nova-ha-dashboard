"use client";

// Paint helpers and the static layer painters: disc, arc, line, polygon.

import {
  resolveOrbColor,
  type OrbArcLayer,
  type OrbDiscLayer,
  type OrbGradientStop,
  type OrbLineLayer,
  type OrbPalette,
  type OrbPolygonLayer,
  type OrbResolvedColor,
} from "../../../../lib/orb-modules";
import { TWO_PI } from "./constants";
import type { OrbFrame } from "./types";

/** Format a resolved color as a canvas rgba() string. */
export function rgba(color: OrbResolvedColor): string {
  return `rgba(${color.rgb[0]}, ${color.rgb[1]}, ${color.rgb[2]}, ${color.alpha})`;
}

// ---------------------------------------------------------------------------
// Layer drawing
// ---------------------------------------------------------------------------

/** Convert a unit-space x/y to canvas pixels for the current frame. */
export function px(frame: OrbFrame, v: number) {
  return v * frame.radiusPx;
}

/**
 * Build a canvas gradient from module stops. Colors are resolved against the
 * frame palette so theme edits and alert pulses apply immediately.
 */
export function buildStops(
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
export function brightestStop(stops: OrbGradientStop[], palette: OrbPalette, alertPulse: number): OrbResolvedColor {
  let best = resolveOrbColor(stops[0].color, palette, alertPulse);
  for (const stop of stops.slice(1)) {
    const resolved = resolveOrbColor(stop.color, palette, alertPulse);
    if (resolved.alpha > best.alpha) best = resolved;
  }
  return best;
}

export function drawDisc(ctx: CanvasRenderingContext2D, layer: OrbDiscLayer, frame: OrbFrame, alertPulse: number) {
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

export function drawArc(ctx: CanvasRenderingContext2D, layer: OrbArcLayer, frame: OrbFrame, alertPulse: number) {
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

export function drawLine(ctx: CanvasRenderingContext2D, layer: OrbLineLayer, frame: OrbFrame, alertPulse: number) {
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

export function drawPolygon(ctx: CanvasRenderingContext2D, layer: OrbPolygonLayer, frame: OrbFrame, alertPulse: number) {
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
