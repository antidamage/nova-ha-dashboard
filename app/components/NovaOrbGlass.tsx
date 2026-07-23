"use client";

// "Liquid glass" overlay for the status orb.
//
// The orb itself is a 2D canvas (see NovaAvatar + orbRenderer). This module
// adds the DOM/SVG glass treatment that sits on top of it:
//
//   1. A chained SVG `feDisplacementMap` stack driven by generated concentric
//      lens maps. Each smaller circular stage compounds the previous stage,
//      so the backdrop bends through a layered glass-ball profile.
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

import { Fragment, type CSSProperties, type RefObject, useEffect, useRef, useState } from "react";
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

export const CONCENTRIC_LENS_LAYER_COUNT = 8;

/** Radius of each nested glass layer, in orb-radius units. */
export function concentricLayerRadius(layerIndex: number, layerCount = CONCENTRIC_LENS_LAYER_COUNT) {
  const index = clamp(Math.round(layerIndex), 0, Math.max(0, layerCount - 1));
  return 1 - (index / Math.max(1, layerCount)) * 0.7;
}

/** Keep compounding visible without allowing the stack to become a hard smear. */
export function concentricLayerScale(layerIndex: number, layerCount = CONCENTRIC_LENS_LAYER_COUNT) {
  return 0.22 + (Math.max(0, layerCount - 1 - layerIndex) / Math.max(1, layerCount)) * 0.16;
}

/**
 * Map the 0-100 "Refraction curve" knob to the *dome fullness* `q` of the
 * modelled spherical glass surface — how much of a full hemisphere the disc
 * spans. The rim of the disc sits at polar angle `asin(q)` on the sphere, so:
 *
 *   - q → 0   : an almost-flat pane. The surface slope stays gentle and nearly
 *               linear across the whole disc, so the background barely bends.
 *   - q → 1   : a near-full hemisphere. The slope runs away toward the rim, so
 *               refraction piles up into a thick, fisheye glass edge.
 *
 * This is what makes the slider *visibly* do something end to end: unlike the
 * old power-exponent (which always pinned the rim at full magnitude and only
 * reshuffled the interior rings), changing q moves both the distribution AND
 * the peak strength of the refraction.
 */
export function refractDomeFullness(refractPower: number) {
  return 0.15 + 0.84 * (clamp(refractPower, 0, 100) / 100);
}

/**
 * Radial refraction magnitude (0..1) at disc-radius fraction `r` for a curved
 * glass surface of dome fullness `q`. Models the lateral ray shift through a
 * spherical cap as proportional to the local surface slope: a point at radius
 * `r` sits at sphere angle `asin(q·r)`, whose slope is `tan` of that angle,
 * i.e. `q·r / sqrt(1 - (q·r)²)`. Apex (`r=0`) is flat → 0; the slope climbs
 * toward the rim and, for a full dome, saturates into a hard refracting edge.
 * Clamped to 1 so a near-hemisphere reads as a thick glassy rim band rather
 * than a single blown-out pixel ring.
 */
export function refractMagnitude(r: number, q: number) {
  const s = q * Math.min(1, r);
  return clamp(s / Math.sqrt(Math.max(1e-6, 1 - s * s)), 0, 1);
}

/**
 * Build one nested circular "lens" displacement map as a data URL.
 *
 * feDisplacementMap shifts each source pixel by `scale * (channel/255 - 0.5)`,
 * reading X from the red channel and Y from the green (128 = no shift). Here
 * the displacement is purely RADIAL — every pixel is pushed straight out along
 * its radius — so the iso-displacement contours are concentric circles. The
 * per-ring magnitude follows the surface slope of a modelled glass dome (see
 * `refractMagnitude`): flat at the apex and accumulating toward the rim, so the
 * "Refraction curve" knob (dome fullness) reshapes how strongly each concentric
 * ring bends the backdrop. `scale` (the Refraction knob) supplies the peak px.
 */
export function buildLensDisplacementMap(
  refractPower: number,
  layerIndex = 0,
  layerCount = CONCENTRIC_LENS_LAYER_COUNT,
  res = 128,
): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const image = ctx.createImageData(res, res);
  const data = image.data;
  const half = res / 2;
  const q = refractDomeFullness(refractPower);
  const layerRadius = concentricLayerRadius(layerIndex, layerCount);
  const rimFade = 0.12;
  for (let y = 0; y < res; y += 1) {
    const ny = (y + 0.5 - half) / half; // -1 .. 1
    for (let x = 0; x < res; x += 1) {
      const nx = (x + 0.5 - half) / half; // -1 .. 1
      const r = Math.hypot(nx, ny);
      // Neutralise the square corners and everything outside this layer. The
      // short fade prevents each nested circle from becoming a harsh seam.
      const edge = r <= 1 ? 1 : Math.max(0, 1 - (r - 1) / 0.28);
      const layerEdge = r <= layerRadius
        ? 1
        : Math.max(0, 1 - (r - layerRadius) / rimFade);
      const idx = (y * res + x) * 4;
      if (r < 1e-4) {
        data[idx] = 128;
        data[idx + 1] = 128;
      } else {
        // Each stage models a smaller spherical cap. Feeding the output into
        // the next stage compounds the refraction across the glass ball.
        const localRadius = r / Math.max(1e-6, layerRadius);
        const magnitude = refractMagnitude(localRadius, q) * edge * layerEdge;
        data[idx] = clamp(128 + (nx / r) * magnitude * 127, 0, 255); // R -> X
        data[idx + 1] = clamp(128 + (ny / r) * magnitude * 127, 0, 255); // G -> Y
      }
      data[idx + 2] = 128; // B unused
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Return the source-coordinate offset needed to resize and optionally invert
 * the backdrop inside the orb. Coordinates are normalised around the disc
 * centre (-1..1). An apparent image scale S samples source coordinate p/S;
 * vertical inversion samples -y/S. -100% is clamped close to zero because an
 * exact zero-sized image has no finite inverse sampling transform.
 */
export function imageTransformDisplacement(
  nx: number,
  ny: number,
  localStretch: number,
  flipVertical: boolean,
) {
  const imageScale = Math.max(0.05, 1 + clamp(localStretch, -100, 100) / 100);
  const sourceX = nx / imageScale;
  const sourceY = (flipVertical ? -ny : ny) / imageScale;
  return { dx: sourceX - nx, dy: sourceY - ny };
}

/** Build the second displacement map that performs the actual image resize. */
export function buildImageTransformMap(
  localStretch: number,
  flipVertical: boolean,
  res = 128,
): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const image = ctx.createImageData(res, res);
  const data = image.data;
  const half = res / 2;
  for (let y = 0; y < res; y += 1) {
    const ny = (y + 0.5 - half) / half;
    for (let x = 0; x < res; x += 1) {
      const nx = (x + 0.5 - half) / half;
      const idx = (y * res + x) * 4;
      if (Math.hypot(nx, ny) <= 1) {
        const { dx, dy } = imageTransformDisplacement(nx, ny, localStretch, flipVertical);
        // The filter uses scale=2*orbSize. A normalised delta of 1 is one
        // radius, therefore it occupies one quarter of the channel range.
        data[idx] = clamp(Math.round(127.5 + dx * 63.75), 0, 255);
        data[idx + 1] = clamp(Math.round(127.5 + dy * 63.75), 0, 255);
      } else {
        data[idx] = 128;
        data[idx + 1] = 128;
      }
      data[idx + 2] = 128;
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
  size,
}: {
  filterId: string;
  glass: NovaGlassSettings;
  size: number;
}) {
  // Map generation requires a browser canvas. Generating in useMemo during
  // SSR leaves the hydrated filter permanently on its no-op fallback, so do
  // it after mount and regenerate whenever the shaping controls change.
  const [lensMaps, setLensMaps] = useState<string[]>([]);
  const [transformMap, setTransformMap] = useState("");
  const transformActive = glass.localStretch !== 0 || glass.flipVertical;
  useEffect(() => {
    setLensMaps(
      Array.from({ length: CONCENTRIC_LENS_LAYER_COUNT }, (_, layerIndex) =>
        buildLensDisplacementMap(
          glass.refractPower,
          layerIndex,
          CONCENTRIC_LENS_LAYER_COUNT,
        ),
      ),
    );
  }, [glass.refractPower]);
  useEffect(() => {
    setTransformMap(
      transformActive ? buildImageTransformMap(glass.localStretch, glass.flipVertical) : "",
    );
  }, [glass.localStretch, glass.flipVertical, transformActive]);
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
          {lensMaps.length === CONCENTRIC_LENS_LAYER_COUNT ? (
            <>
              {lensMaps.map((lensMap, layerIndex) => {
                const mapId = `lensMap-${layerIndex}`;
                const softMapId = `lensMapSoft-${layerIndex}`;
                const warpId = `lensWarp-${layerIndex}`;
                return (
                  <Fragment key={layerIndex}>
                    <feImage
                      key={`${mapId}-image`}
                      href={lensMap}
                      x="-10%"
                      y="-10%"
                      width="120%"
                      height="120%"
                      preserveAspectRatio="none"
                      result={mapId}
                    />
                    <feGaussianBlur in={mapId} stdDeviation={blur} result={softMapId} />
                    <feDisplacementMap
                      in={layerIndex === 0 ? "SourceGraphic" : `lensWarp-${layerIndex - 1}`}
                      in2={softMapId}
                      scale={scale * concentricLayerScale(layerIndex)}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result={warpId}
                    />
                  </Fragment>
                );
              })}
              {transformActive && transformMap ? (
                <>
                  <feImage
                    href={transformMap}
                    x="-10%"
                    y="-10%"
                    width="120%"
                    height="120%"
                    preserveAspectRatio="none"
                    result="imageTransformMap"
                  />
                  <feDisplacementMap
                    in={`lensWarp-${CONCENTRIC_LENS_LAYER_COUNT - 1}`}
                    in2="imageTransformMap"
                    scale={size * 2}
                    xChannelSelector="R"
                    yChannelSelector="G"
                  />
                </>
              ) : null}
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
