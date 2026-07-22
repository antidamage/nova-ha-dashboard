"use client";

// "Liquid glass" overlay for the status orb.
//
// The orb itself is a 2D canvas (see NovaAvatar + orbRenderer). This module
// adds the DOM/SVG glass treatment that sits on top of it:
//
//   1. An SVG `feDisplacementMap` driven by a generated radial "lens" normal
//      map, applied (by NovaAvatar) to the wrapper that holds the canvas +
//      these layers, so the whole orb refracts like a curved piece of glass.
//   2. A screen-blended reflection of a grey/silver room with overhead lights
//      that pans across the orb as it moves on the page / the pointer sweeps —
//      the give-away that you're looking at a shiny convex surface.
//   3. A gloss highlight for the fixed key light, over the top-left.
//
// Everything here is DOM-only (SVG filters + CSS blend modes), so — unlike the
// cross-platform orb modules — there is no tvOS counterpart; the Apple TV
// renderer simply never draws it. All knobs come from the theme's
// `glass` block (NovaGlassSettings), 0-100 magnitudes mapped to concrete
// filter/pixel values by the small helpers below.

import { type CSSProperties, type RefObject, useEffect, useMemo, useRef } from "react";
import type { NovaGlassSettings } from "./avatarThemeModel";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Linear map of a 0-100 knob onto a [lo, hi] output range. */
function pctTo(value: number, lo: number, hi: number) {
  return lo + (clamp(value, 0, 100) / 100) * (hi - lo);
}

// ---- Concrete effect values derived from the 0-100 knobs -------------------

/** feDisplacementMap scale in px — how hard the lens refracts the backdrop. */
export function glassDisplaceScale(glass: NovaGlassSettings) {
  return pctTo(glass.displace, 0, 44);
}

/** Gaussian blur (stdDeviation) applied to the lens map — the "liquid" melt. */
function glassMapBlur(glass: NovaGlassSettings) {
  return pctTo(glass.smoothness, 0, 7);
}

/**
 * Cast shadow + glass-edge highlight as a `box-shadow` on the glass disc.
 * Deliberately NOT a `filter: drop-shadow` on an ancestor: a filter on any
 * ancestor of the glass makes it a "backdrop root" and silently kills the
 * backdrop-filter refraction (verified in Chromium). box-shadow is safe. The
 * inset pair paints a faint bright rim so the glass edge reads as a lip.
 */
export function glassBoxShadow(glass: NovaGlassSettings) {
  const y = pctTo(glass.shadow, 2, 16).toFixed(1);
  const blur = pctTo(glass.shadow, 8, 40).toFixed(1);
  const alpha = pctTo(glass.shadow, 0.18, 0.6).toFixed(3);
  return (
    `0 ${y}px ${blur}px rgba(0, 0, 0, ${alpha}),` +
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
function glassDriftPx(glass: NovaGlassSettings) {
  return pctTo(glass.drift, 0, 24);
}

// ---------------------------------------------------------------------------
// Displacement (lens normal) map
// ---------------------------------------------------------------------------

/**
 * Build a radial "lens" displacement map as a data URL.
 *
 * feDisplacementMap shifts each source pixel by `scale * (channel/255 - 0.5)`,
 * reading X from the red channel and Y from the green. So a neutral pixel is
 * (128, 128): no shift. We ramp red horizontally and green vertically from the
 * centre outward, with an ease that concentrates the change toward the rim —
 * exactly the surface-normal field of a convex lens, which is why the orb's
 * content compresses and bends at its edge like real glass.
 *
 * `curvature` (0-100) picks the ease exponent: 0 ≈ a gentle linear bulge,
 * 100 ≈ a flat centre with a sharp meniscus at the rim.
 */
export function buildLensDisplacementMap(curvature: number, res = 128): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const image = ctx.createImageData(res, res);
  const data = image.data;
  const half = res / 2;
  const exponent = 1.15 + (clamp(curvature, 0, 100) / 100) * 2.6; // 1.15 .. 3.75
  for (let y = 0; y < res; y += 1) {
    const ny = (y + 0.5 - half) / half; // -1 .. 1
    for (let x = 0; x < res; x += 1) {
      const nx = (x + 0.5 - half) / half; // -1 .. 1
      const dist = Math.hypot(nx, ny);
      // Neutralise the square corners so only the disc bends; fade the ramp
      // out in a thin band just past the unit circle to avoid a hard ring.
      const edge = dist <= 1 ? 1 : Math.max(0, 1 - (dist - 1) / 0.28);
      const rampX = Math.sign(nx) * Math.pow(Math.min(1, Math.abs(nx)), exponent) * edge;
      const rampY = Math.sign(ny) * Math.pow(Math.min(1, Math.abs(ny)), exponent) * edge;
      const idx = (y * res + x) * 4;
      data[idx] = clamp(128 + rampX * 127, 0, 255); // R -> X displacement
      data[idx + 1] = clamp(128 + rampY * 127, 0, 255); // G -> Y displacement
      data[idx + 2] = 128; // B unused
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

// ---------------------------------------------------------------------------
// Filter definition
// ---------------------------------------------------------------------------

/**
 * The hidden `<svg>` carrying the displacement filter. NovaAvatar references
 * it as `filter: url(#filterId)` on the glass wrapper. Rendered outside that
 * wrapper (a filter def draws nothing itself). Degrades to a pass-through on
 * the server / before the map is generated, so the orb never blanks.
 */
export function NovaOrbGlassFilter({
  filterId,
  glass,
}: {
  filterId: string;
  glass: NovaGlassSettings;
}) {
  const map = useMemo(() => buildLensDisplacementMap(glass.curvature), [glass.curvature]);
  const scale = glassDisplaceScale(glass);
  const blur = glassMapBlur(glass);

  return (
    <svg className="nova-orb-glass-defs" aria-hidden="true" focusable="false">
      <defs>
        {/* color-interpolation-filters=sRGB keeps 128 as the true neutral so
            the displacement map isn't gamma-shifted into a constant bias. */}
        <filter
          id={filterId}
          x="-10%"
          y="-10%"
          width="120%"
          height="120%"
          colorInterpolationFilters="sRGB"
        >
          {map ? (
            <>
              <feImage
                href={map}
                x="-10%"
                y="-10%"
                width="120%"
                height="120%"
                preserveAspectRatio="none"
                result="lensMap"
              />
              <feGaussianBlur in="lensMap" stdDeviation={blur} result="lensMapSoft" />
              <feDisplacementMap
                in="SourceGraphic"
                in2="lensMapSoft"
                scale={scale}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </>
          ) : (
            <feOffset in="SourceGraphic" dx="0" dy="0" />
          )}
        </filter>
      </defs>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Reflection + gloss layers
// ---------------------------------------------------------------------------

/**
 * The two blend-mode layers that go INSIDE the glass wrapper, over the canvas:
 * the panning silver-room reflection and the fixed gloss highlight. Owns the
 * drift animation that slides the reflection as the orb moves on the page or
 * the pointer sweeps across it.
 *
 * `active` gates the drift loop (parent turns it off when the orb is hidden,
 * in lite mode, or the reflection is dialled to nothing); reduced-motion is
 * honoured here directly.
 */
export function NovaOrbGlassLayers({
  glass,
  hostRef,
  active,
}: {
  glass: NovaGlassSettings;
  hostRef: RefObject<HTMLElement | null>;
  active: boolean;
}) {
  const reflectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = reflectionRef.current;
    const host = hostRef.current;
    if (!el || !host || !active) {
      el?.style.setProperty("--nova-orb-refl-x", "0px");
      el?.style.setProperty("--nova-orb-refl-y", "0px");
      return;
    }
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const amp = glassDriftPx(glass);
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    let pointerX = 0;
    let pointerY = 0;
    let pointerAt = 0;
    let raf = 0;
    let prevCenterX = Number.NaN;
    let prevCenterY = Number.NaN;

    const step = () => {
      const rect = host.getBoundingClientRect();
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // How far the orb sits from the viewport centre — makes the reflection
      // sweep as the orb migrates (e.g. the speech fly-to-centre) or scales.
      const posX = (centerX - vw / 2) / (vw / 2);
      const posY = (centerY - vh / 2) / (vh / 2);

      // The pointer acts as a moving light: the reflection leans toward it.
      const pointerLive = performance.now() - pointerAt < 1400;
      const ptrX = pointerLive ? (pointerX - centerX) / (vw / 2) : 0;
      const ptrY = pointerLive ? (pointerY - centerY) / (vh / 2) : 0;

      targetX = clamp(posX * 0.55 + ptrX * 0.85, -1, 1) * amp;
      targetY = clamp(posY * 0.55 + ptrY * 0.85, -1, 1) * amp;

      curX += (targetX - curX) * 0.12;
      curY += (targetY - curY) * 0.12;
      el.style.setProperty("--nova-orb-refl-x", `${curX.toFixed(2)}px`);
      el.style.setProperty("--nova-orb-refl-y", `${curY.toFixed(2)}px`);

      const moving =
        Number.isNaN(prevCenterX) ||
        Math.abs(centerX - prevCenterX) > 0.1 ||
        Math.abs(centerY - prevCenterY) > 0.1;
      prevCenterX = centerX;
      prevCenterY = centerY;

      const settling = Math.abs(targetX - curX) > 0.05 || Math.abs(targetY - curY) > 0.05;
      raf = settling || moving || pointerLive ? requestAnimationFrame(step) : 0;
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(step);
    };
    const onPointerMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      pointerAt = performance.now();
      schedule();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // The speech migration is a CSS transform transition on the host — no
    // scroll/pointer event fires, so kick the loop when it starts and let the
    // `moving` guard keep it alive for the whole journey.
    host.addEventListener("transitionrun", schedule);
    host.addEventListener("transitionend", schedule);
    schedule();

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      host.removeEventListener("transitionrun", schedule);
      host.removeEventListener("transitionend", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [glass, hostRef, active]);

  const reflectionStyle = {
    opacity: pctTo(glass.reflection, 0, 0.9),
  } as CSSProperties;
  const glossStyle = {
    opacity: pctTo(glass.gloss, 0, 0.9),
  } as CSSProperties;

  return (
    <>
      <div className="nova-orb-reflection" aria-hidden="true" ref={reflectionRef} style={reflectionStyle}>
        <div className="nova-orb-reflection-room" />
      </div>
      <div className="nova-orb-gloss" aria-hidden="true" style={glossStyle} />
    </>
  );
}
