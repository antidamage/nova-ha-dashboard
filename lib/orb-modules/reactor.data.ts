// Built-in Status Orb module "Reactor Core". Registered in ./catalogue.

import type { OrbModule } from "./layer-types";

/**
 * "Reactor Core" — a denser, machine-like look: dark shell, a bright pulsing
 * core, and a few thick arcs snapped onto three concentric rings (the "rings"
 * distribution) so it reads as spinning reactor coils rather than a particle
 * cloud. Demonstrates: different layer count/order, ring distribution, screen
 * blending, and an alert-only flash ring.
 */
export const REACTOR_MODULE: OrbModule = {
  formatVersion: 1,
  id: "reactor",
  name: "Reactor Core",
  description: "Bright pulsing core with thick coil arcs on three rings.",
  alertPulsePeriod: 1.0,
  layers: [
    // Dark shell: outer theme color collapsing to near-black at the rim.
    {
      id: "shell",
      type: "disc",
      stops: [
        { at: 0, color: { theme: "gradientOuter", alpha: 0.85 } },
        { at: 1, color: { hex: "#000000" } },
      ],
    },
    // Soft center energy bloom under the coils, in the theme center color.
    {
      id: "core-bloom",
      type: "disc",
      blend: "screen",
      clip: true,
      radius: 0.62,
      stops: [
        { at: 0, color: { theme: "gradientCenter" } },
        { at: 1, color: { theme: "gradientCenter", alpha: 0 } },
      ],
    },
    // Nine thick coil arcs snapped to three concentric rings. Fewer, fatter,
    // slower segments than classic — a totally different proportion language.
    {
      id: "coils",
      type: "arcField",
      blend: "additive",
      glow: 0.35,
      count: 9,
      radiusMin: 0.38,
      radiusMax: 0.86,
      distribution: "rings",
      ringCount: 3,
      widthMin: 0.05,
      widthMax: 0.09,
      colors: [{ theme: "line1" }, { theme: "line2" }, { theme: "line3" }],
      idleSweepMin: 0.06,
      idleSweepMax: 0.14,
      loadSweep: 0.42,
      speedMin: 0.02,
      speedMax: 0.07,
      loadSpeed: 0.45,
      sweepEase: 2,
      velocityEase: 2,
    },
    // White-hot core that breathes slowly on top of the coils.
    {
      id: "core",
      type: "disc",
      blend: "additive",
      radius: 0.2,
      pulse: { period: 3.2, min: 0.7, max: 1 },
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0.9 } },
        { at: 0.45, color: { theme: "gradientCenter", alpha: 0.6 } },
        { at: 1, color: { theme: "gradientCenter", alpha: 0 } },
      ],
    },
    // Containment ring at the rim in the first line color.
    {
      id: "containment-ring",
      type: "ring",
      radius: 0.96,
      width: 0.02,
      color: { theme: "line1", alpha: 0.55 },
      glow: 0.2,
    },
    // Inner shadow keeps the shell rounded; reuses the theme bevel strength.
    {
      id: "bevel-shadow",
      type: "ring",
      radius: 0.93,
      width: 0.06,
      color: { theme: "innerShadow" },
      glow: 0.3,
    },
    // Alert flash: a ring in the alert color that only exists while the gym
    // alert is active, strobing with the module's pulse period.
    {
      id: "alert-flash",
      type: "ring",
      blend: "additive",
      radius: 0.9,
      width: 0.05,
      color: { theme: "gradientAlert" },
      glow: 0.4,
      pulse: { period: 1.0, min: 0, max: 0.9, alertOnly: true },
    },
    // Single restrained cap highlight so it still reads as a physical object.
    {
      id: "cap-highlight",
      type: "disc",
      clip: true,
      center: { x: 0, y: -0.5 },
      radius: 0.55,
      scaleY: 0.45,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0.28 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
  ],
};
