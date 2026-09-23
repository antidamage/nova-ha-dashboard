// The Tech orb module's knob face (.rotary-encoder-knob): the moulded dome that
// lib/orb-modules/tech.data.ts stacks inside the colour channel, under the outer
// lip.
//
// It lives beside the module document rather than inside it for the same reason
// ./tech.unlock does: it is the module's skin-gated KNOB TREATMENT — nine layers
// in light/dark pairs, none of them a line of the stack's own logic — and
// tech.data.ts is at its token budget.
//
// Adeline, 2026-09-12: the orb's shading is deliberately softer than the knob's
// own CSS, every shadow roughly half strength and the dome's light broader,
// because at orb size the knob's contrast reads as grime rather than as a
// gently convex surface. Light mode is a soft off-white dome with its shading
// pulled back, not an inversion of the dark one.
//
// Each pair is gated on `knobThemeResolved` (1 = light, 0 = dark), the resolved
// form of the module's `knobTheme` choice — the id that carries a concrete
// treatment once the setting's `auto` stop has been answered (see
// lib/orb-modules/settings-model.ts). So exactly one treatment of each surface
// draws, whichever stop the owner picked.

import type { OrbLayer } from "./layer-types";

/** The knob's dome, the falloff over it, and the lip that catches the light. */
export const TECH_DOME_LAYERS: OrbLayer[] = [
// ---- Knob face (.rotary-encoder-knob): one fixed light from above-left.
// Base dome, then the highlight and the bounce, then the edge darkening.
{
  id: "dome-dark",
  type: "disc",
  enabledWhen: { setting: "knobThemeResolved", max: 0.5 },
  radius: 0.7610,
  gradientFrom: { x: 0, y: -0.1221, radius: 0 },
  gradientTo: { x: 0, y: -0.1221, radius: 0.8142 },
  // Fixed paint, like the light dome below it, and for the same reason the
  // knob's own CSS records (app/styles/controls/rotary-encoder.css, "The two
  // skins each name their own face colour"): a treatment that inherits the page
  // is not the treatment it was set to. These three stops are the knob's dark
  // skin computed from its own `--re-tint: #191b20` — the same relationship
  // `dome-light` has to the light skin's `#eceef1`. Reading them from the
  // theme's gradient slots instead made this dome a WHITE knob on the light
  // theme, so Dark and Light drew the same thing there.
  stops: [
    { at: 0, color: { hex: "#424448" } },
    { at: 0.7, color: { hex: "#191b20" } },
    { at: 1, color: { hex: "#131418" } },
  ],
},
{
  id: "dome-light",
  type: "disc",
  enabledWhen: { setting: "knobThemeResolved", min: 0.5 },
  radius: 0.7610,
  gradientFrom: { x: 0, y: -0.1221, radius: 0 },
  gradientTo: { x: 0, y: -0.1221, radius: 0.8142 },
  stops: [
    { at: 0, color: { hex: "#ffffff" } },
    { at: 0.68, color: { hex: "#eceef1" } },
    { at: 1, color: { hex: "#cbced4" } },
  ],
},
{
  id: "dome-highlight-dark",
  type: "disc",
  enabledWhen: { setting: "knobThemeResolved", max: 0.5 },
  center: { x: -0.2433, y: -0.3654 },
  radius: 0.6627,
  stops: [
    { at: 0, color: { hex: "#ffffff", alpha: 0.16 } },
    { at: 1, color: { hex: "#ffffff", alpha: 0 } },
  ],
},
{
  id: "dome-highlight-light",
  type: "disc",
  enabledWhen: { setting: "knobThemeResolved", min: 0.5 },
  center: { x: -0.2433, y: -0.3654 },
  radius: 0.6627,
  stops: [
    { at: 0, color: { hex: "#ffffff", alpha: 0.6 } },
    { at: 1, color: { hex: "#ffffff", alpha: 0 } },
  ],
},
{
  id: "dome-bounce-dark",
  type: "disc",
  enabledWhen: { setting: "knobThemeResolved", max: 0.5 },
  center: { x: 0.1827, y: 0.5785 },
  radius: 0.6627,
  stops: [
    { at: 0, color: { hex: "#000000", alpha: 0.1 } },
    { at: 1, color: { hex: "#000000", alpha: 0 } },
  ],
},
{
  id: "dome-bounce-light",
  type: "disc",
  enabledWhen: { setting: "knobThemeResolved", min: 0.5 },
  center: { x: 0.1827, y: 0.5785 },
  radius: 0.6627,
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
  enabledWhen: { setting: "knobThemeResolved", max: 0.5 },
  radius: 0.7610,
  gradientFrom: { x: 0, y: 0, radius: 0.4260 },
  gradientTo: { x: 0, y: 0, radius: 0.7610 },
  stops: [
    { at: 0, color: { hex: "#000000", alpha: 0 } },
    { at: 1, color: { hex: "#000000", alpha: 0.13 } },
  ],
},
{
  id: "dome-edge-light",
  type: "disc",
  enabledWhen: { setting: "knobThemeResolved", min: 0.5 },
  radius: 0.7610,
  gradientFrom: { x: 0, y: 0, radius: 0.4260 },
  gradientTo: { x: 0, y: 0, radius: 0.7610 },
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
  radius: 0.7555,
  width: 0.0114,
  from: 0.55,
  to: 0.95,
  stops: [
    { at: 0, color: { hex: "#ffffff", alpha: 0 } },
    { at: 0.5, color: { hex: "#ffffff", alpha: 0.12 } },
    { at: 1, color: { hex: "#ffffff", alpha: 0 } },
  ],
},
];
