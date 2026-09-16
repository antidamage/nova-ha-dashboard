"use client";

import type { OrbBlendMode } from "../../../../lib/orb-modules";

export const TWO_PI = Math.PI * 2;

/** Map the cross-platform blend names onto canvas composite operations. */
export const BLEND_TO_COMPOSITE: Record<OrbBlendMode, GlobalCompositeOperation> = {
  normal: "source-over",
  additive: "lighter",
  screen: "screen",
  multiply: "multiply",
};

/** Samples per strand loop. Sine octaves use whole cycle counts so the path closes seamlessly. */
export const TURBULENCE_SAMPLES = 96;
