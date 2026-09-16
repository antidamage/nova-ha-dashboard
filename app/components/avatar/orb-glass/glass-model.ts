"use client";

// 0-100 glass knobs mapped to concrete CSS / filter values.

import type { NovaGlassSettings } from "../theme-model/types";

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Linear map of a 0-100 knob onto a [lo, hi] output range. */
export function pctTo(value: number, lo: number, hi: number) {
  return lo + (clamp(value, 0, 100) / 100) * (hi - lo);
}

// ---- Concrete effect values derived from the 0-100 knobs -------------------

/** feDisplacementMap scale in px — how hard the lens refracts the backdrop. */
export function glassDisplaceScale(glass: NovaGlassSettings) {
  return pctTo(glass.displace, 0, 44);
}

/** Gaussian blur (stdDeviation) applied to the lens map — the "liquid" melt. */
export function glassMapBlur(glass: NovaGlassSettings) {
  return pctTo(glass.smoothness, 0, 7);
}

/**
 * Gaussian blur (stdDeviation, px) applied to the refracted image itself once
 * the lens has bent it — a frosted-glass softening. Stored directly in pixels
 * (0-10), unlike the 0-100 magnitude knobs, so the slider value is the blur.
 */
export function glassImageBlur(glass: NovaGlassSettings) {
  return clamp(glass.imageBlur, 0, 10);
}

/**
 * Opacity (0..1) of the whole refraction group. The renderer cross-fades the
 * refracted image back toward the plain backdrop with this weight, so 1 is full
 * refraction and 0 is the un-bent page showing through the disc.
 */
export function glassRefractionOpacity(glass: NovaGlassSettings) {
  return clamp(glass.refractionOpacity, 0, 100) / 100;
}

/**
 * Cast shadow + glass-edge highlight as a `box-shadow` on the glass disc.
 * Deliberately NOT a `filter: drop-shadow` on an ancestor: a filter on any
 * ancestor of the glass makes it a "backdrop root" and silently kills the
 * backdrop-filter refraction (verified in Chromium). box-shadow is safe. The
 * inset pair paints a faint bright rim so the glass edge reads as a lip. The
 * cast itself uses overlapping near, mid, and far shadows. A tight, heavy near
 * layer makes the darkness fall off rapidly from the orb edge; the far layer
 * keeps a wide share of the weight so the curve levels out into a long, faint
 * tail. Weight ratios between layers rise (0.32, then 0.75) so each step loses
 * less than the one before.
 */
export function glassBoxShadow(glass: NovaGlassSettings) {
  const y = pctTo(glass.shadow, 2, 16).toFixed(1);
  const blur = pctTo(glass.shadow, 8, 40);
  const alpha = pctTo(glass.shadow, 0.18, 0.6);
  const castShadow = (blurScale: number, alphaScale: number) =>
    `0 ${y}px ${(blur * blurScale).toFixed(1)}px rgba(0, 0, 0, ${(alpha * alphaScale).toFixed(3)})`;
  return (
    `${castShadow(0.2, 0.62)},` +
    `${castShadow(0.7, 0.2)},` +
    `${castShadow(2.2, 0.15)},` +
    " inset 0 1px 1px rgba(255, 255, 255, 0.3)," +
    " inset 0 0 0 1px rgba(255, 255, 255, 0.12)"
  );
}

/** Overall opacity of the orb canvas — clarity dials it toward see-through. */
export function glassCanvasOpacity(glass: NovaGlassSettings) {
  return 1 - pctTo(glass.clarity, 0, 1) * 0.35;
}

/**
 * Radial mask that fades the orb canvas out toward its centre, so the middle
 * goes clear (the refraction reads through it) while the graphics survive at
 * the rim — "effects fade in from the edges". `none` at clarity 0 leaves the
 * orb fully solid.
 */
export function glassCanvasMask(glass: NovaGlassSettings): string | undefined {
  if (glass.clarity <= 0) return undefined;
  const inner = pctTo(glass.clarity, 0, 55).toFixed(1);
  const outer = pctTo(glass.clarity, 45, 90).toFixed(1);
  return `radial-gradient(circle at 50% 46%, transparent ${inner}%, #000 ${outer}%)`;
}

/** Max reflection pan (px) as the orb / pointer moves. */
export function glassDriftPx(glass: NovaGlassSettings) {
  return pctTo(glass.drift, 0, 24);
}

/**
 * Whether the browser will actually render `backdrop-filter: url(#svgFilter)`.
 *
 * WebKit (desktop Safari AND every browser on iOS — they are all WebKit under
 * the hood) accepts the CSS `backdrop-filter` property but silently ignores an
 * SVG filter *reference*: it only honours the built-in filter FUNCTIONS
 * (blur(), saturate(), brightness(), …). So the whole displacement-refraction
 * disc renders as a no-op there and the glass "doesn't display". Every WebKit
 * browser reports the Apple vendor string, which is the reliable way to spot
 * the family (a plain `CSS.supports('backdrop-filter','url(#x)')` returns true
 * in Safari even though nothing paints). Callers use the CSS-function fallback
 * below when this is false. Defaults to `true` off the client (SSR) so the
 * first paint matches the server markup and only corrects after mount.
 */
export function supportsSvgBackdropFilter(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.vendor !== "Apple Computer, Inc.";
}

/**
 * CSS filter-function backdrop used where SVG-url backdrop filters don't paint
 * (WebKit / iOS — see `supportsSvgBackdropFilter`). The displacement refraction
 * can't be reproduced with filter functions, so this leans into the same read
 * Apple's own "liquid glass" material uses: a genuine backdrop blur plus a
 * saturation/brightness lift, so the page behind the orb frosts and its colours
 * bloom through the disc. The reflection + gloss layers (plain CSS gradients)
 * still paint on top on every browser, supplying the specular/edge cues. Blur
 * combines the "melt" (smoothness) and frosted (imageBlur) knobs; the colour
 * lift tracks gloss/reflection; the whole thing fades out with
 * refractionOpacity so a cleared disc stays clear.
 */
export function glassCssBackdropFilter(glass: NovaGlassSettings): string {
  const op = glassRefractionOpacity(glass);
  const blur = (pctTo(glass.smoothness, 3, 12) + glassImageBlur(glass)) * op;
  const saturate = 1 + pctTo(glass.gloss, 0, 0.8) * op;
  const brightness = 1 + pctTo(glass.reflection, 0, 0.12) * op;
  return (
    `blur(${blur.toFixed(1)}px) ` +
    `saturate(${saturate.toFixed(2)}) ` +
    `brightness(${brightness.toFixed(2)})`
  );
}

/**
 * Gentle CSS blur (px) applied to the WebKit backdrop *copy* (see
 * `NovaOrbGlassBackdropCopy`) after the lens displaces it, so the synthetic
 * refraction reads as frosted glass to match the real `backdrop-filter: blur()`
 * frost on the disc. Kept light (melt knob + a fraction of the frosted knob) —
 * the copy is the crisp, refracted layer, so over-blurring it would wash the
 * lens warp back out.
 */
export function glassCopyBlurPx(glass: NovaGlassSettings) {
  return pctTo(glass.smoothness, 0, 2.5) + glassImageBlur(glass) * 0.6;
}
