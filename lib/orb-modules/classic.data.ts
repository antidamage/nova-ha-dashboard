// Built-in Status Orb module "Classic Glass". Registered in ./catalogue.

import type { OrbModule } from "./layer-types";

/**
 * "Classic Glass" — a faithful, data-driven port of the original hand-coded
 * NovaAvatar drawing (background gradient, fifty additive arcs, bevel rings,
 * and the six-layer HAL-style gloss stack). All magic numbers were derived
 * from the previous implementation at its reference 128 px size, converted
 * into unit-space fractions of the orb radius (R = 0.48 * size, so e.g. the
 * old `size * 0.25` glow becomes 0.5208 R).
 */
export const CLASSIC_MODULE: OrbModule = {
  formatVersion: 1,
  id: "classic",
  name: "Classic Glass",
  description: "Radial gradient core, fifty additive arcs, glass gloss.",
  alertPulsePeriod: 1.2,
  layers: [
    // Background — radial gradient from the theme center color to the outer
    // color; the outer stop pulses toward the alert color when the gym
    // counter is overdue (alertTheme drives the mix).
    {
      id: "background",
      type: "disc",
      stops: [
        { at: 0, color: { theme: "gradientCenter" } },
        { at: 1, color: { theme: "gradientOuter", alertTheme: "gradientAlert" } },
      ],
    },
    // The animated load field: 50 additive glowing arcs spread across the
    // orb interior, cycling through the three theme line colors.
    {
      id: "load-arcs",
      type: "arcField",
      blend: "additive",
      glow: 0.5208,
      count: 50,
      radiusMin: 0.1,
      radiusMax: 0.95,
      ringJitter: 0.08,
      widthMin: 0.0104,
      widthMax: 0.0833,
      colors: [{ theme: "line1" }, { theme: "line2" }, { theme: "line3" }],
      idleSweepMin: 0.00025,
      idleSweepMax: 0.001,
      loadSweep: 1,
      speedMin: 0.0557,
      speedMax: 0.1194,
      loadSpeed: 0.2546,
    },
    // Outer bevel — a faint white ring just past the rim.
    {
      id: "bevel-light",
      type: "ring",
      radius: 1.0081,
      width: 0.0163,
      color: { hex: "#ffffff", alpha: 0.05 },
      glow: 0.5208,
    },
    // Inner bevel shadow — dark ring inside the rim; strength follows the
    // theme's innerShadowOpacity via the innerShadow color slot.
    {
      id: "bevel-shadow",
      type: "ring",
      radius: 0.9512,
      width: 0.0488,
      color: { theme: "innerShadow" },
      glow: 0.5208,
    },
    // ---- Glass gloss stack (all clipped to the orb interior) ----
    // Bottom inner vignette: a dark gradient hugging the lower rim that
    // sells the curvature before the highlights brighten the top.
    {
      id: "bottom-vignette",
      type: "disc",
      clip: true,
      gradientFrom: { x: 0, y: 0.55, radius: 0.15 },
      gradientTo: { x: 0, y: 0.25, radius: 1.05 },
      stops: [
        { at: 0, color: { hex: "#000000", alpha: 0 } },
        { at: 0.7, color: { hex: "#000000", alpha: 0 } },
        { at: 1, color: { theme: "innerShadow" } },
      ],
    },
    // Primary cap highlight: broad soft ellipse in the upper third — the
    // "you're looking at glass" cue. Alphas are the old GLOSS_OPACITY (0.15)
    // times the per-reflection multipliers (4.5 / 1.6).
    {
      id: "cap-highlight",
      type: "disc",
      clip: true,
      center: { x: -0.0833, y: -0.42 },
      radius: 0.66,
      scaleY: 0.5152,
      rotation: -0.03,
      gradientFrom: { x: -0.0833, y: -0.318, radius: 0 },
      gradientTo: { x: -0.0833, y: -0.42, radius: 0.693 },
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0.675 } },
        { at: 0.45, color: { hex: "#ffffff", alpha: 0.24 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
    // Rim streak: bright thin arc on the upper-left rim, tapering along its
    // length (gradient runs along the sweep).
    {
      id: "rim-streak",
      type: "arc",
      clip: true,
      radius: 0.8617,
      width: 0.1058,
      from: 0.54,
      to: 0.8,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0 } },
        { at: 0.4, color: { hex: "#ffffff", alpha: 0.525 } },
        { at: 0.65, color: { hex: "#ffffff", alpha: 0.225 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
    // Secondary "kiss" highlight upper-right — a second light source.
    {
      id: "kiss-highlight",
      type: "disc",
      clip: true,
      center: { x: 0.5, y: -0.38 },
      radius: 0.16,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0.75 } },
        { at: 0.5, color: { hex: "#ffffff", alpha: 0.225 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
    // Faint refraction band low and right — adds to the wet look.
    {
      id: "refraction-band",
      type: "arc",
      clip: true,
      radius: 0.9186,
      width: 0.0651,
      from: 0.04,
      to: 0.21,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0 } },
        { at: 0.5, color: { hex: "#ffffff", alpha: 0.21 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
    // Lower-edge rim reflections, half the strength of the upper streak:
    // bottom-right fades toward bottom-center...
    {
      id: "lower-rim-right",
      type: "arc",
      clip: true,
      radius: 0.8617,
      width: 0.0895,
      from: 0.025,
      to: 0.23,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0 } },
        { at: 0.35, color: { hex: "#ffffff", alpha: 0.225 } },
        { at: 0.6, color: { hex: "#ffffff", alpha: 0.15 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
    // ...and bottom-left mirrors it with the gradient reversed so the bright
    // peak lands on the outer (left) side of the curve.
    {
      id: "lower-rim-left",
      type: "arc",
      clip: true,
      radius: 0.8617,
      width: 0.0895,
      from: 0.27,
      to: 0.475,
      reverse: true,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0 } },
        { at: 0.35, color: { hex: "#ffffff", alpha: 0.225 } },
        { at: 0.6, color: { hex: "#ffffff", alpha: 0.15 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
  ],
};
