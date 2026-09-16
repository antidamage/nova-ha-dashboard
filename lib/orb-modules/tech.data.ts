// Built-in Status Orb module "Tech". Registered in ./catalogue.

import type { OrbModule } from "./layer-types";

/**
 * "Tech" — the RotaryEncoder knob (app/components/RotaryEncoder.tsx) drawn as
 * an orb: the same moulded dome, the same sunken colour channel around it, the
 * same raised outer lip. No knob indicator line and no lights — the orb is a
 * readout, not a control — and deliberately no glass gloss and no ring
 * turbulence/fibres. The only motion is thin activity arcs circling inside the
 * colour channel, whose paint is the status colour.
 *
 * Geometry is ported from the knob's CSS custom properties, where the dial's
 * footprint is `--re-outer` = size + 2 x ring (0.1) + 2 x bevel (0.022) =
 * 1.244 x size. Dividing through by half that footprint puts the knob in orb
 * unit space (rim = 1):
 *
 *   knob face      r <= 0.804          (--re-size / --re-outer)
 *   colour channel 0.804 .. 0.965      (--re-ring, the sunken band)
 *   outer lip      0.965 .. 1          (--re-bevel)
 *
 * The shading is deliberately softer than the knob's own (Adeline,
 * 2026-09-12): every shadow here is roughly half the strength of the CSS it
 * came from, and the dome's light is broader, because at orb size the knob's
 * contrast reads as grime rather than as a gently convex surface. The **colour
 * channel is the exception** (Adeline, later the same day): it is the lighting
 * colour ring exactly — `.rotary-encoder-ring-shade`'s 160deg gradient and its
 * inset shadow, at full strength, through the `gradient` and `innerShadow`
 * fields on a ring layer.
 *
 * The `light` setting is the knob's light/dark treatment (`knobSkin`), and it
 * carries the same design decision: light mode is a soft off-white dome with
 * its shading pulled back, not an inversion of the dark one. Paired layers are
 * gated on it with `enabledWhen`, so exactly one treatment of each surface
 * draws.
 */
export const TECH_MODULE: OrbModule = {
  formatVersion: 1,
  id: "tech",
  name: "Tech",
  description: "The Nova knob as an orb: moulded dome, sunken status channel.",
  alertPulsePeriod: 1.1,
  settings: [
    {
      id: "light",
      label: "Light knob",
      description: "The pale knob treatment instead of the dark one",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
    },
  ],
  layers: [
    // ---- Outer lip (--re-bevel): the body of the raised rim. ----
    {
      id: "lip-dark",
      type: "disc",
      enabledWhen: { setting: "light", max: 0.5 },
      stops: [{ at: 0, color: { theme: "gradientOuter" } }],
    },
    {
      id: "lip-light",
      type: "disc",
      enabledWhen: { setting: "light", min: 0.5 },
      stops: [{ at: 0, color: { hex: "#eceef1" } }],
    },
    // Its 160deg shading: dark down the top-left, a little light bottom-right.
    {
      id: "lip-shade-dark",
      type: "disc",
      enabledWhen: { setting: "light", max: 0.5 },
      stops: [
        { at: 0, color: { hex: "#000000", alpha: 0.06 } },
        { at: 1, color: { hex: "#000000", alpha: 0.22 } },
      ],
    },
    {
      id: "lip-shade-light",
      type: "disc",
      enabledWhen: { setting: "light", min: 0.5 },
      stops: [
        { at: 0, color: { hex: "#000000", alpha: 0.02 } },
        { at: 1, color: { hex: "#000000", alpha: 0.07 } },
      ],
    },
    {
      id: "lip-highlight",
      type: "arc",
      radius: 0.982,
      width: 0.035,
      from: 0.48,
      to: 0.95,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0.04 } },
        { at: 0.5, color: { hex: "#ffffff", alpha: 0.2 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0.04 } },
      ],
    },
    {
      id: "lip-shadow",
      type: "arc",
      radius: 0.982,
      width: 0.035,
      from: 0.02,
      to: 0.46,
      stops: [
        { at: 0, color: { hex: "#000000", alpha: 0 } },
        { at: 0.5, color: { hex: "#000000", alpha: 0.14 } },
        { at: 1, color: { hex: "#000000", alpha: 0 } },
      ],
    },
    // ---- Colour channel (--re-ring): the well, the status paint, the
    // activity arcs, then the sunken shading over the lot. ----
    {
      id: "channel-well",
      type: "ring",
      radius: 0.884,
      width: 0.161,
      color: { hex: "#000000", alpha: 0.5 },
    },
    {
      id: "status-paint",
      type: "ring",
      radius: 0.884,
      width: 0.161,
      color: { theme: "line1", alertTheme: "gradientAlert" },
    },
    // Thin activity arcs circling inside the channel — the classic orb's
    // load-reactive field, confined to the band and kept hairline.
    {
      id: "activity-arcs",
      type: "arcField",
      blend: "additive",
      glow: 0.1,
      count: 18,
      radiusMin: 0.824,
      radiusMax: 0.945,
      ringJitter: 0.012,
      widthMin: 0.005,
      widthMax: 0.013,
      colors: [{ theme: "line2" }, { theme: "line3" }, { theme: "gymNumber" }],
      cap: "butt",
      idleSweepMin: 0.004,
      idleSweepMax: 0.02,
      loadSweep: 0.34,
      speedMin: 0.04,
      speedMax: 0.13,
      loadSpeed: 0.22,
    },
    // Alert restatement of the channel paint, strobing only while the alert
    // is up. The knob has no equivalent; the orb needs one.
    {
      id: "status-alert",
      type: "ring",
      blend: "additive",
      glow: 0.18,
      pulse: { period: 1.1, min: 0, max: 1, alertOnly: true },
      radius: 0.884,
      width: 0.161,
      color: { theme: "gradientAlert" },
    },
    // .rotary-encoder-ring-shade, exactly: the 160deg wash that makes the band
    // read as a channel rather than a painted stripe, plus its inset shadow.
    // Adeline, 2026-09-12: this band is the one place the orb does NOT soften
    // the knob's CSS — it is to be the lighting colour ring, the same gradient
    // and the same inner shadow, so the two read as the same part. The arcs
    // that used to approximate the wash, and the flat rings that stood in for
    // the inset shadow, are gone.
    {
      id: "channel-shade-dark",
      type: "ring",
      enabledWhen: { setting: "light", max: 0.5 },
      radius: 0.884,
      width: 0.161,
      color: { hex: "#000000", alpha: 0 },
      gradient: {
        angle: 160,
        stops: [
          { at: 0, color: { hex: "#000000", alpha: 0.42 } },
          { at: 0.4, color: { hex: "#000000", alpha: 0 } },
          { at: 1, color: { hex: "#ffffff", alpha: 0.18 } },
        ],
      },
      // inset 0 0 calc(var(--re-ring) * 0.5): half the band's own width, and
      // the band is 0.161 of the orb radius.
      innerShadow: { blur: 0.0805, color: { hex: "#000000", alpha: 0.55 } },
    },
    {
      id: "channel-shade-light",
      type: "ring",
      enabledWhen: { setting: "light", min: 0.5 },
      radius: 0.884,
      width: 0.161,
      color: { hex: "#000000", alpha: 0 },
      gradient: {
        angle: 160,
        stops: [
          { at: 0, color: { hex: "#000000", alpha: 0.22 } },
          { at: 0.42, color: { hex: "#000000", alpha: 0 } },
          { at: 1, color: { hex: "#ffffff", alpha: 0.5 } },
        ],
      },
      innerShadow: { blur: 0.0805, color: { hex: "#000000", alpha: 0.28 } },
    },
    // ---- Inner bevel: the lip between channel and dome, plus the dome's own
    // shadow cast down onto the channel. ----
    {
      id: "dome-shadow",
      type: "arc",
      radius: 0.822,
      width: 0.045,
      from: 0.03,
      to: 0.47,
      stops: [
        { at: 0, color: { hex: "#000000", alpha: 0 } },
        { at: 0.5, color: { hex: "#000000", alpha: 0.14 } },
        { at: 1, color: { hex: "#000000", alpha: 0 } },
      ],
    },
    {
      id: "inner-bevel",
      type: "ring",
      radius: 0.81,
      width: 0.012,
      color: { hex: "#000000", alpha: 0.22 },
    },
    // ---- Knob face (.rotary-encoder-knob): one fixed light from above-left.
    // Base dome, then the highlight and the bounce, then the edge darkening.
    {
      id: "dome-dark",
      type: "disc",
      enabledWhen: { setting: "light", max: 0.5 },
      radius: 0.804,
      gradientFrom: { x: 0, y: -0.129, radius: 0 },
      gradientTo: { x: 0, y: -0.129, radius: 0.86 },
      stops: [
        { at: 0, color: { theme: "gradientCenter" } },
        { at: 0.7, color: { theme: "gradientOuter" } },
        { at: 1, color: { theme: "gradientOuter" } },
      ],
    },
    {
      id: "dome-light",
      type: "disc",
      enabledWhen: { setting: "light", min: 0.5 },
      radius: 0.804,
      gradientFrom: { x: 0, y: -0.129, radius: 0 },
      gradientTo: { x: 0, y: -0.129, radius: 0.86 },
      stops: [
        { at: 0, color: { hex: "#ffffff" } },
        { at: 0.68, color: { hex: "#eceef1" } },
        { at: 1, color: { hex: "#cbced4" } },
      ],
    },
    {
      id: "dome-highlight-dark",
      type: "disc",
      enabledWhen: { setting: "light", max: 0.5 },
      center: { x: -0.257, y: -0.386 },
      radius: 0.7,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0.16 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
    {
      id: "dome-highlight-light",
      type: "disc",
      enabledWhen: { setting: "light", min: 0.5 },
      center: { x: -0.257, y: -0.386 },
      radius: 0.7,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0.6 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
    {
      id: "dome-bounce-dark",
      type: "disc",
      enabledWhen: { setting: "light", max: 0.5 },
      center: { x: 0.193, y: 0.611 },
      radius: 0.7,
      stops: [
        { at: 0, color: { hex: "#000000", alpha: 0.1 } },
        { at: 1, color: { hex: "#000000", alpha: 0 } },
      ],
    },
    {
      id: "dome-bounce-light",
      type: "disc",
      enabledWhen: { setting: "light", min: 0.5 },
      center: { x: 0.193, y: 0.611 },
      radius: 0.7,
      stops: [
        { at: 0, color: { hex: "#000000", alpha: 0.05 } },
        { at: 1, color: { hex: "#000000", alpha: 0 } },
      ],
    },
    // The knob's inset edge shadow (inset 0 0 8% black) plus the base
    // gradient's darkened last stop, as one ring of falloff at the dome edge.
    {
      id: "dome-edge-dark",
      type: "disc",
      enabledWhen: { setting: "light", max: 0.5 },
      radius: 0.804,
      gradientFrom: { x: 0, y: 0, radius: 0.45 },
      gradientTo: { x: 0, y: 0, radius: 0.804 },
      stops: [
        { at: 0, color: { hex: "#000000", alpha: 0 } },
        { at: 1, color: { hex: "#000000", alpha: 0.13 } },
      ],
    },
    {
      id: "dome-edge-light",
      type: "disc",
      enabledWhen: { setting: "light", min: 0.5 },
      radius: 0.804,
      gradientFrom: { x: 0, y: 0, radius: 0.45 },
      gradientTo: { x: 0, y: 0, radius: 0.804 },
      stops: [
        { at: 0, color: { hex: "#000000", alpha: 0 } },
        { at: 1, color: { hex: "#000000", alpha: 0.05 } },
      ],
    },
    // The dome's top lip catches the light, the way the inner bevel's inset
    // highlight does on the knob.
    {
      id: "dome-lip",
      type: "arc",
      radius: 0.798,
      width: 0.012,
      from: 0.55,
      to: 0.95,
      stops: [
        { at: 0, color: { hex: "#ffffff", alpha: 0 } },
        { at: 0.5, color: { hex: "#ffffff", alpha: 0.12 } },
        { at: 1, color: { hex: "#ffffff", alpha: 0 } },
      ],
    },
  ],
};
