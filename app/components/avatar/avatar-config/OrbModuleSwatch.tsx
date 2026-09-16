"use client";

import { useEffect, useRef } from "react";
import { type OrbModule } from "../../../../lib/orb-modules";
import type { NovaAvatarTheme } from "../theme-model/types";
import { buildOrbPalette } from "../../orbModules";
import { createOrbRenderer } from "../orb-renderer/renderer";
import { ORB_SWATCH_SIZE } from "./constants";

/**
 * Static thumbnail of an orb module rendered with the theme being edited.
 * Uses the real module renderer (one short simulated run so the animated
 * field layers reach a representative pose, keeping only the final frame),
 * so every dropdown option previews its actual geometry in the user's
 * current colors — the orb-module equivalent of the theme library's
 * color-band swatch.
 */
export function OrbModuleSwatch({ module, theme }: { module: OrbModule; theme: NovaAvatarTheme }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    // Setting the bitmap size also resets the context transform/state, so
    // repeated effect runs (theme edits) never accumulate scale.
    canvas.width = ORB_SWATCH_SIZE * dpr;
    canvas.height = ORB_SWATCH_SIZE * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const renderer = createOrbRenderer(module);
    const palette = buildOrbPalette(theme);
    // Simulate ~2s at moderate load so arcField/lineField segments grow into
    // a recognizable pose; only the last frame stays on the canvas.
    for (let i = 0; i <= 40; i += 1) {
      ctx.clearRect(0, 0, ORB_SWATCH_SIZE, ORB_SWATCH_SIZE);
      renderer.render(ctx, {
        centerX: ORB_SWATCH_SIZE / 2,
        centerY: ORB_SWATCH_SIZE / 2,
        radiusPx: ORB_SWATCH_SIZE * 0.48,
        palette,
        load: 0.6,
        alertActive: false,
        nowMs: i * 50,
        dtSec: 0.05,
      });
    }
  }, [module, theme]);

  // Display size comes from the cyber-select-swatch class (44px in the
  // trigger, 34px inside menu options), scaling the fixed 44px bitmap.
  return <canvas ref={canvasRef} className="cyber-select-swatch" aria-hidden="true" />;
}
