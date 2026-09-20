// The Tech orb module's embossed unlock ring: the band of polished glass
// (lib/orb-modules/tech.data.ts) that the knob's CSS puts between its lip and
// the colour channel.
//
// It lives beside the module document rather than inside it because it is a
// pair of skin-gated treatments — four layers, none of them a line of the
// stack's own logic — and tech.data.ts is at its token budget already.
//
// The band's own numbers come from the CSS rather than from a redrawing:
// `--re-unlock-annulus` masks the knob's band from 78.75% to 84.25% of
// `--re-ring-outer` (1.27 x size), which is 0.5 .. 0.535 of the knob's
// diameter, so 0.7610 .. 0.8143 of the orb's rim once unit space is halved by
// DIAL_RADIUS_SHARE — see the geometry note at the top of tech.data.ts.
//
// The lit half of the ring is not here: the orb's ring lights because
// `OrbDialIndicator` overlays the encoder's own lit layers while the stack is
// open (app/styles/controls/rotary-unlock-ring.css), so the module only ever
// draws the dark glass the knob shows when it is locked.

import type { OrbLayer } from "./layer-types";

/** The knob's band: 0.5 .. 0.535 of its diameter, over the 0.657 rim share. */
export const UNLOCK_RING_INNER = 0.761;
export const UNLOCK_RING_OUTER = 0.8143;
/** Ring-layer centre and stroke width for that band. */
export const UNLOCK_RING_RADIUS = (UNLOCK_RING_INNER + UNLOCK_RING_OUTER) / 2;
export const UNLOCK_RING_WIDTH = UNLOCK_RING_OUTER - UNLOCK_RING_INNER;

/**
 * Dark polished glass: the knob's `.rotary-encoder-unlock-glass` wash, at full
 * strength like the colour channel rather than softened like the dome. Running
 * 180deg over the whole orb and clipped to the band is what makes the band read
 * as a convex surface — brightest at 12 o'clock, darkest at 6.
 */
const GLASS_DARK: OrbLayer = {
  id: "unlock-glass-dark",
  type: "ring",
  enabledWhen: { setting: "light", max: 0.5 },
  radius: UNLOCK_RING_RADIUS,
  width: UNLOCK_RING_WIDTH,
  color: { hex: "#000000", alpha: 0 },
  gradient: {
    angle: 180,
    stops: [
      { at: 0.05, color: { hex: "#a8b2c4", alpha: 0.34 } },
      { at: 0.2, color: { hex: "#5c6474", alpha: 0.5 } },
      { at: 0.45, color: { hex: "#20242e", alpha: 0.6 } },
      { at: 0.78, color: { hex: "#0c0e13", alpha: 0.66 } },
      { at: 1, color: { hex: "#08090c", alpha: 0.7 } },
    ],
  },
};

/** The light knob's smoked glass, which keeps more of its reflections. */
const GLASS_LIGHT: OrbLayer = {
  id: "unlock-glass-light",
  type: "ring",
  enabledWhen: { setting: "light", min: 0.5 },
  radius: UNLOCK_RING_RADIUS,
  width: UNLOCK_RING_WIDTH,
  color: { hex: "#000000", alpha: 0 },
  gradient: {
    angle: 180,
    stops: [
      { at: 0.05, color: { hex: "#d4d9e2", alpha: 0.5 } },
      { at: 0.22, color: { hex: "#969daa", alpha: 0.46 } },
      { at: 0.48, color: { hex: "#4a505c", alpha: 0.42 } },
      { at: 0.8, color: { hex: "#3a3f4a", alpha: 0.44 } },
      { at: 1, color: { hex: "#343943", alpha: 0.46 } },
    ],
  },
};

/**
 * The specular streaks crossing the band on the diagonal. They sit above the
 * glass, as they do above the lit layer on the knob, because they are what
 * separates polished glass from a flat grey ring.
 */
const SPEC_DARK: OrbLayer = {
  id: "unlock-spec-dark",
  type: "ring",
  enabledWhen: { setting: "light", max: 0.5 },
  radius: UNLOCK_RING_RADIUS,
  width: UNLOCK_RING_WIDTH,
  color: { hex: "#000000", alpha: 0 },
  gradient: {
    angle: 157,
    stops: [
      { at: 0.33, color: { hex: "#ffffff", alpha: 0 } },
      { at: 0.4, color: { hex: "#ffffff", alpha: 0.34 } },
      { at: 0.44, color: { hex: "#ffffff", alpha: 0.06 } },
      { at: 0.51, color: { hex: "#ffffff", alpha: 0 } },
      { at: 0.65, color: { hex: "#ffffff", alpha: 0 } },
      { at: 0.71, color: { hex: "#ffffff", alpha: 0.15 } },
      { at: 0.78, color: { hex: "#ffffff", alpha: 0 } },
    ],
  },
};

const SPEC_LIGHT: OrbLayer = {
  id: "unlock-spec-light",
  type: "ring",
  enabledWhen: { setting: "light", min: 0.5 },
  radius: UNLOCK_RING_RADIUS,
  width: UNLOCK_RING_WIDTH,
  color: { hex: "#000000", alpha: 0 },
  gradient: {
    angle: 157,
    stops: [
      { at: 0.32, color: { hex: "#ffffff", alpha: 0 } },
      { at: 0.4, color: { hex: "#ffffff", alpha: 0.65 } },
      { at: 0.44, color: { hex: "#ffffff", alpha: 0.1 } },
      { at: 0.52, color: { hex: "#ffffff", alpha: 0 } },
      { at: 0.64, color: { hex: "#ffffff", alpha: 0 } },
      { at: 0.71, color: { hex: "#ffffff", alpha: 0.3 } },
      { at: 0.79, color: { hex: "#ffffff", alpha: 0 } },
    ],
  },
};

/** The band, in the stack's own order: the glass, then the reflections over it. */
export const TECH_UNLOCK_LAYERS: OrbLayer[] = [GLASS_DARK, GLASS_LIGHT, SPEC_DARK, SPEC_LIGHT];
