"use client";

import {
  orbLayerGateOpen,
  type OrbLayer,
  type OrbModule,
} from "../../../../lib/orb-modules";
import { BLEND_TO_COMPOSITE, TWO_PI } from "./constants";
import { drawLineField, drawArcField } from "./draw-fields";
import { drawRing } from "./draw-rings";
import { drawArc, drawDisc, drawLine, drawPolygon } from "./draw-shapes";
import { createFieldSegments, createLineSegments } from "./motion-model";
import type { FieldSegment, LineSegment, OrbFrame, OrbRenderer, TurbulentFiber } from "./types";

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
    // The theme's alert-rate slider, applied to every alert period below. A
    // frame that does not carry one runs at the module's declared cadence.
    const pulseScale = typeof frame.alertPulseScale === "number"
      && Number.isFinite(frame.alertPulseScale)
      && frame.alertPulseScale > 0
      ? frame.alertPulseScale
      : 1;
    const alertPulse = frame.alertPulseOverride !== undefined
      ? Math.max(0, Math.min(1, frame.alertPulseOverride))
      : frame.alertActive
        ? (1 - Math.cos((frame.nowMs / (module.alertPulsePeriod * pulseScale * 1000)) * TWO_PI)) / 2
        : 0;

    module.layers.forEach((layer: OrbLayer, index: number) => {
      if (layer.enabled === false) return;
      // Setting-bound visibility: how a module ships two treatments of one
      // surface (the Tech skin's light/dark knob) and lets a setting choose.
      if (!orbLayerGateOpen(layer.enabledWhen, frame.settings)) return;

      // Layer opacity = static opacity x pulse wave. alertOnly layers do not
      // render at all while the alert is inactive.
      let opacity = layer.opacity ?? 1;
      if (layer.pulse) {
        if (layer.pulse.alertOnly && !frame.alertActive) return;
        // Alert-only layers follow the consonant envelope during speech so
        // every part of the alert animation beats to the same rhythm.
        const wave = layer.pulse.alertOnly && frame.alertPulseOverride !== undefined
          ? Math.max(0, Math.min(1, frame.alertPulseOverride))
          : (1 - Math.cos((frame.nowMs / (layer.pulse.period * (layer.pulse.alertOnly ? pulseScale : 1) * 1000)) * TWO_PI)) / 2;
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
