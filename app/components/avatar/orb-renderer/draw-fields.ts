"use client";

// Animated field painters: arcField and lineField. Each advances its
// segments (motion-model.ts) and then strokes them.

import {
  resolveOrbColor,
  type OrbArcFieldLayer,
  type OrbLineFieldLayer,
} from "../../../../lib/orb-modules";
import { TWO_PI } from "./constants";
import { px, rgba } from "./draw-shapes";
import { stepLineSegment, stepSegment } from "./motion-model";
import type { FieldSegment, LineSegment, OrbFrame } from "./types";

export function drawArcField(
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

export function drawLineField(
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
