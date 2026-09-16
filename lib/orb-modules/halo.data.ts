// Built-in Status Orb module "Halo". Registered in ./catalogue.

import type { OrbModule } from "./layer-types";

/**
 * "Halo" — a minimal, airy look: no filled background at all (the page shows
 * through the middle), one dominant rim ring, and a fine swarm of thin arcs
 * confined to a narrow outer band. Demonstrates: transparent-center shape,
 * a narrow radial band, many small segments, and multiply-free layering.
 */
export const HALO_MODULE: OrbModule = {
  formatVersion: 1,
  id: "halo",
  name: "Halo",
  description: "Open center with a fine arc swarm on a narrow outer band.",
  alertPulsePeriod: 1.6,
  // The halo ring's turbulence knobs, surfaced as sliders in the Status Orb
  // config. Defaults sit at the calm end: a single, gently breathing circle.
  settings: [
    { id: "fibers", label: "Fibres", description: "Strands in the halo ring", min: 1, max: 12, step: 1, default: 1 },
    { id: "chaos", label: "Chaos", description: "0 = perfect circle, 100 = crackling lightning", min: 0, max: 100, step: 1, default: 0 },
    { id: "weave", label: "Weave", description: "How independently the strands wander and cross", min: 0, max: 100, step: 1, default: 30 },
    { id: "speed", label: "Speed", description: "How fast the ring pulses and the strands writhe", min: 0, max: 100, step: 1, default: 30 },
    { id: "pulse", label: "Pulse", description: "Breathing depth of the ring", min: 0, max: 100, step: 1, default: 20 },
    { id: "softness", label: "Softness", description: "Glow and edge softening on the strands", min: 0, max: 100, step: 1, default: 40 },
  ],
  layers: [
    // Soft center glow only — deliberately no opaque background disc, so the
    // halo floats over whatever is behind it.
    {
      id: "center-glow",
      type: "disc",
      blend: "screen",
      radius: 0.55,
      stops: [
        { at: 0, color: { theme: "gradientCenter", alpha: 0.5 } },
        { at: 1, color: { theme: "gradientCenter", alpha: 0 } },
      ],
    },
    // The dominant halo ring; pulses toward the alert color when overdue.
    // Every turbulence knob is bound to a module setting above, so the config
    // sliders morph it live from a perfect breathing circle into weaving
    // lightning strands.
    {
      id: "halo-ring",
      type: "ring",
      blend: "additive",
      radius: 0.8,
      width: 0.025,
      color: { theme: "gradientOuter", alpha: 0.9, alertTheme: "gradientAlert" },
      glow: 0.45,
      turbulence: {
        fibers: { setting: "fibers" },
        chaos: { setting: "chaos" },
        weave: { setting: "weave" },
        speed: { setting: "speed" },
        pulse: { setting: "pulse" },
        softness: { setting: "softness" },
      },
    },
    // Eighty hair-thin arcs in the narrow band straddling the halo ring.
    // High idle sweep keeps the band visible even at zero load; load mostly
    // adds speed rather than length, so activity reads as "spinning faster".
    {
      id: "band-swarm",
      type: "arcField",
      blend: "additive",
      glow: 0.25,
      count: 80,
      radiusMin: 0.68,
      radiusMax: 0.95,
      ringJitter: 0.04,
      widthMin: 0.006,
      widthMax: 0.016,
      colors: [{ theme: "line1" }, { theme: "line2" }, { theme: "line3" }],
      idleSweepMin: 0.02,
      idleSweepMax: 0.1,
      loadSweep: 0.35,
      speedMin: 0.03,
      speedMax: 0.09,
      loadSpeed: 0.6,
    },
    // A faint inner counter-ring for depth.
    {
      id: "inner-ring",
      type: "ring",
      radius: 0.62,
      width: 0.008,
      color: { theme: "line3", alpha: 0.35 },
    },
    // Alert beacon dot at the top of the ring, alert-only.
    {
      id: "alert-beacon",
      type: "disc",
      blend: "additive",
      center: { x: 0, y: -0.8 },
      radius: 0.09,
      pulse: { period: 1.6, min: 0, max: 1, alertOnly: true },
      stops: [
        { at: 0, color: { theme: "gradientAlert" } },
        { at: 1, color: { theme: "gradientAlert", alpha: 0 } },
      ],
    },
  ],
};
