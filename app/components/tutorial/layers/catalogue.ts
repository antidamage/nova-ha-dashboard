/**
 * What each control is built from, layer by layer (specs/tutorial-mode.md,
 * "Layer sets"). Keyed by the real selectors, so `catalogue.test.ts` can mount
 * the components and fail when a selector stops matching or a new layer
 * appears that is not named here. Paragraphs: three sentences, 280 characters.
 */

import type { OrbGroup } from "./orbGroups";

export type LayerMethod = "CSS" | "SVG" | "Canvas 2D" | "WebGL";

/**
 * How a card's preview is made. Every kind but `orb-group` is drawn once, when
 * the view opens; `orb-group` cards are drawn live, every frame.
 */
export type LayerSource =
  /** An element inside the control, drawn in the control's frame. */
  | { kind: "dom"; selector: string }
  /** The knob's floating ring layer, which it portals to the body. */
  | { kind: "rings" }
  /** A page-level element, drawn on its own at the viewport's shape. */
  | { kind: "page"; selector: string }
  /** A flat fill in an element's computed background colour. */
  | { kind: "fill"; selector: string }
  /** One group of the orb module's Canvas 2D layers, drawn live (orbGroups.ts). */
  | { kind: "orb-group"; group: OrbGroup }
  | { kind: "webgl"; term: FluidTerm }
  | { kind: "pseudo"; selector: string; pseudo: "::before" | "::after" };

export type FluidTerm = "base" | "peaks" | "hue" | "apex" | "texture";

export type Layer = {
  id: string;
  name: string;
  method: LayerMethod;
  source: LayerSource;
  why: string;
};

export type LayerSetId = "rotary" | "orb" | "background";

export type LayerSet = { id: LayerSetId; title: string; layers: Layer[] };

export const PARAGRAPH_MAX_CHARS = 280;

const dial = (selector: string): LayerSource => ({ kind: "dom", selector });

/** Bottom to top. */
export const LAYER_SETS: Record<LayerSetId, LayerSet> = {
  rotary: {
    id: "rotary",
    title: "Rotary knob",
    layers: [
      { id: "outer-bevel", name: "Outer bevel", method: "CSS", source: dial(".rotary-encoder-outer-bevel"),
        why: "Gradients and shadows on one element. It scales with a single size variable and costs nothing to redraw." },
      { id: "glow", name: "Glow", method: "CSS", source: dial(".rotary-encoder-glow"),
        why: "A blurred paint through the ring's annulus. The compositor blurs it once, instead of the page redrawing a shadow every frame." },
      { id: "ring", name: "Colour ring", method: "CSS", source: dial(".rotary-encoder-ring"),
        why: "A conic-gradient behind a mask. The colour changes by setting one custom property, with no repaint of anything else." },
      { id: "ring-shade", name: "Ring shade", method: "CSS", source: dial(".rotary-encoder-ring-shade"),
        why: "The sunken lighting over the ring, kept separate so the ring's colour can change underneath it." },
      { id: "inner-bevel", name: "Inner bevel", method: "CSS", source: dial(".rotary-encoder-inner-bevel"),
        why: "The lip between ring and knob, drawn the same way as the outer bevel." },
      { id: "unlock-ring", name: "Unlock ring", method: "CSS", source: dial(".rotary-encoder-unlock-ring"),
        why: "Three masked layers (glass, lit colour, specular), so the lit colour fades in over 450ms without redrawing the glass." },
      { id: "knob", name: "Knob face", method: "CSS", source: dial(".rotary-encoder-knob"),
        why: "Radial gradients. The light and dark skins are one class change." },
      { id: "rotor", name: "Rotor and index line", method: "CSS", source: dial(".rotary-encoder-rotor"),
        why: "Turned by a transform, which the compositor applies without layout or paint, so the knob follows a finger at full frame rate." },
      { id: "spec", name: "Specular highlight", method: "CSS", source: dial(".rotary-encoder-spec"),
        why: "A fixed highlight that does not rotate, so the light source stays put while the knob turns." },
      { id: "face", name: "Face text and lights", method: "CSS", source: dial(".rotary-encoder-label, .rotary-encoder-leds, .rotary-encoder-channel"),
        why: "Real text and elements, so they stay sharp at any size, are read by screen readers, and are measured to fit the face." },
      { id: "rings", name: "Arc sliders", method: "SVG", source: { kind: "rings" },
        why: "Arcs, thumbs and text on a curved path need exact geometry. SVG gives each ring its own hit area and curved labels." },
      { id: "title", name: "Title arc", method: "SVG", source: { kind: "dom", selector: ".rotary-encoder-title-arc" },
        why: "The name set on a path over the knob. SVG text on a path keeps it sharp and lets it be measured and cut to fit." },
    ],
  },
  orb: {
    id: "orb",
    title: "Status orb",
    layers: [
      { id: "voice-glow", name: "Voice glow", method: "CSS", source: { kind: "dom", selector: ".nova-avatar-voice-glow" },
        why: "A radial gradient that fades in while Nova listens. There is nothing to draw per frame." },
      { id: "glass", name: "Glass disc", method: "CSS", source: { kind: "dom", selector: ".nova-orb-glass" },
        why: "A backdrop-filter refracts the real page behind the orb through an SVG lens filter. Safari can't filter a live backdrop, so it gets a copy." },
      { id: "body-base", name: "Body: base discs", method: "Canvas 2D", source: { kind: "orb-group", group: "base" },
        why: "The orb module's filled discs, the body's base. One canvas redraw a frame is far cheaper than hundreds of moving DOM nodes." },
      { id: "body-fields", name: "Body: fields", method: "Canvas 2D", source: { kind: "orb-group", group: "fields" },
        why: "Arc and line fields: many short segments moved every frame. This is why the body is a canvas and not DOM." },
      { id: "body-rings", name: "Body: rings", method: "Canvas 2D", source: { kind: "orb-group", group: "rings" },
        why: "The module's rings, whose sweep eases toward the host's CPU load. Redrawn each frame on the same canvas." },
      { id: "body-marks", name: "Body: marks", method: "Canvas 2D", source: { kind: "orb-group", group: "marks" },
        why: "The module's arcs, lines and polygons, drawn on the same canvas in the same pass." },
      { id: "body-gloss", name: "Body: gloss", method: "Canvas 2D", source: { kind: "orb-group", group: "gloss" },
        why: "Layers clipped to the orb's rim: the module's own highlights, drawn last so they sit over everything else in the body." },
      { id: "reflection", name: "Reflection and gloss", method: "CSS", source: { kind: "dom", selector: ".nova-orb-reflection" },
        why: "Blend-mode layers over the body. The reflection drifts by a transform as the orb moves, which the compositor does for free." },
      { id: "indicator", name: "Dial indicator", method: "CSS", source: { kind: "dom", selector: ".orb-dial-indicator" },
        why: "The knob's own ring and unlock-ring layers, reused, so the orb's dial lights exactly like every other knob." },
      { id: "counter", name: "Counter", method: "CSS", source: { kind: "dom", selector: ".nova-avatar-gym-counter" },
        why: "Real text over the canvas, so it stays sharp when the orb scales and is read by screen readers." },
    ],
  },
  background: {
    id: "background",
    title: "Background",
    layers: [
      { id: "theme", name: "Theme colour", method: "CSS", source: { kind: "fill", selector: ".dashboard-shell" },
        why: "The flat base colour. It is all that remains with the background turned off, which costs no GPU at all." },
      { id: "fluid-base", name: "Fluid field", method: "WebGL", source: { kind: "webgl", term: "base" },
        why: "One full-screen fragment shader. The GPU draws the whole moving field in one pass, and the page's main thread does nothing." },
      { id: "fluid-peaks", name: "Peaks and warp", method: "WebGL", source: { kind: "webgl", term: "peaks" },
        why: "The bright moving peaks, warped by noise in the same shader, so adding them costs a few instructions per pixel." },
      { id: "fluid-hue", name: "Hue spread", method: "WebGL", source: { kind: "webgl", term: "hue" },
        why: "Colour drift across the peaks, computed per pixel from the theme's accent, so it follows any theme." },
      { id: "fluid-apex", name: "Apex glow", method: "WebGL", source: { kind: "webgl", term: "apex" },
        why: "The highlight at each peak, in the theme's highlight colour." },
      { id: "fluid-texture", name: "Mosaic texture", method: "WebGL", source: { kind: "webgl", term: "texture" },
        why: "A tiled texture scaled to the screen's pixel ratio, so it looks the same on a phone and on the wall panel." },
      { id: "grid", name: "Grid lines", method: "CSS", source: { kind: "pseudo", selector: ".dashboard-shell", pseudo: "::before" },
        why: "Repeating gradients on a pseudo-element. Free to draw, and they go with the background when it is off." },
      { id: "scanlines", name: "Scan grid", method: "CSS", source: { kind: "pseudo", selector: ".dashboard-shell", pseudo: "::after" },
        why: "A second, fainter gradient grid at 35% opacity, kept on its own layer so its strength is one number." },
      { id: "header-fade", name: "Header fade", method: "CSS", source: { kind: "page", selector: ".header-fade-strip" },
        why: "A gradient behind the corner buttons that keeps them readable over anything that scrolls under them." },
    ],
  },
};
