// Built-in Status Orb module "Cross". Registered in ./catalogue.

import type { OrbModule } from "./layer-types";

/**
 * "Cross" — a flat, sigil-like look inspired by retro game UI: a chunky X in
 * the inner gradient color sitting inside a thin diamond frame, with the
 * frame and its corner accents in the outer gradient color. Activity is shown
 * by status lines that ride along the X's two bars (a lineField with one
 * track per bar, so half the lines travel the TL-BR diagonal and half the
 * TR-BL diagonal): short at idle, longer with load, bouncing between the bar
 * ends, randomly reversing, and individually desynced. Demonstrates the
 * straight-edged primitives (line/polygon/lineField) and random color
 * assignment.
 */
export const CROSS_MODULE: OrbModule = {
  formatVersion: 1,
  id: "cross",
  name: "Cross",
  description: "Diamond-framed X with status lines riding its bars.",
  alertPulsePeriod: 1.2,
  layers: [
    // Soft dark backing so the sigil and gym counter read over any page
    // content — the design is otherwise open like halo.
    {
      id: "backing",
      type: "disc",
      stops: [
        { at: 0, color: { hex: "#000000", alpha: 0.5 } },
        { at: 1, color: { hex: "#000000", alpha: 0 } },
      ],
    },
    // The X: two chunky diagonal bars in the inner gradient color. Both
    // pulse toward the alert color while the gym alert is active.
    {
      id: "x-bar-desc",
      type: "line",
      from: { x: -0.5, y: -0.5 },
      to: { x: 0.5, y: 0.5 },
      width: 0.18,
      color: { theme: "gradientCenter", alertTheme: "gradientAlert" },
      cap: "butt",
    },
    {
      id: "x-bar-asc",
      type: "line",
      from: { x: -0.5, y: 0.5 },
      to: { x: 0.5, y: -0.5 },
      width: 0.18,
      color: { theme: "gradientCenter", alertTheme: "gradientAlert" },
      cap: "butt",
    },
    // Status lines: six segments split across the two bar tracks (three per
    // diagonal), randomly colored from the theme line slots, additive so
    // they glow against the bars beneath them.
    {
      id: "status-lines",
      type: "lineField",
      blend: "additive",
      glow: 0.3,
      count: 6,
      tracks: [
        { from: { x: -0.5, y: -0.5 }, to: { x: 0.5, y: 0.5 } },
        { from: { x: -0.5, y: 0.5 }, to: { x: 0.5, y: -0.5 } },
      ],
      widthMin: 0.05,
      widthMax: 0.07,
      colors: [{ theme: "line1" }, { theme: "line2" }, { theme: "line3" }],
      colorMode: "random",
      idleLengthMin: 0.12,
      idleLengthMax: 0.22,
      loadLength: 0.9,
      speedMin: 0.12,
      speedMax: 0.3,
      loadSpeed: 0.45,
    },
    // Thin diamond frame around the X in the outer gradient color.
    {
      id: "frame",
      type: "polygon",
      points: [
        { x: 0, y: -0.92 },
        { x: 0.92, y: 0 },
        { x: 0, y: 0.92 },
        { x: -0.92, y: 0 },
      ],
      color: { theme: "gradientOuter" },
      width: 0.055,
    },
    // Small filled diamond accents just inside each frame vertex.
    {
      id: "accent-n",
      type: "polygon",
      points: [
        { x: 0, y: -0.78 },
        { x: 0.06, y: -0.72 },
        { x: 0, y: -0.66 },
        { x: -0.06, y: -0.72 },
      ],
      color: { theme: "gradientOuter" },
      fill: true,
    },
    {
      id: "accent-e",
      type: "polygon",
      points: [
        { x: 0.72, y: -0.06 },
        { x: 0.78, y: 0 },
        { x: 0.72, y: 0.06 },
        { x: 0.66, y: 0 },
      ],
      color: { theme: "gradientOuter" },
      fill: true,
    },
    {
      id: "accent-s",
      type: "polygon",
      points: [
        { x: 0, y: 0.66 },
        { x: 0.06, y: 0.72 },
        { x: 0, y: 0.78 },
        { x: -0.06, y: 0.72 },
      ],
      color: { theme: "gradientOuter" },
      fill: true,
    },
    {
      id: "accent-w",
      type: "polygon",
      points: [
        { x: -0.72, y: -0.06 },
        { x: -0.66, y: 0 },
        { x: -0.72, y: 0.06 },
        { x: -0.78, y: 0 },
      ],
      color: { theme: "gradientOuter" },
      fill: true,
    },
    // Alert flash: the frame restated in the alert color, strobing only
    // while the gym alert is active.
    {
      id: "alert-frame",
      type: "polygon",
      blend: "additive",
      glow: 0.4,
      pulse: { period: 1.2, min: 0, max: 1, alertOnly: true },
      points: [
        { x: 0, y: -0.92 },
        { x: 0.92, y: 0 },
        { x: 0, y: 0.92 },
        { x: -0.92, y: 0 },
      ],
      color: { theme: "gradientAlert" },
      width: 0.055,
    },
  ],
};
