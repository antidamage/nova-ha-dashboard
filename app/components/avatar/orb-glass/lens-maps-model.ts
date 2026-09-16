"use client";

import { clamp } from "./glass-model";

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
  // Fraction of THIS lens's own radius over which the refraction eases back to
  // neutral (128). This is the crux of making the recursive stack read as one
  // smooth glass ball: `refractMagnitude` RISES to its maximum right at the rim
  // (localRadius = 1), so without an ease the layer peaks at full strength and
  // is then hard-cut to zero just outside its radius. Stacking N such layers
  // lands N concentric displacement discontinuities on top of one another,
  // which the browser renders as hard chevron seams around a dead, undisplaced
  // core. Easing each layer smoothly to neutral at its own rim lets the nested
  // lenses overlap and compound into one continuous refraction instead.
  const rimEase = 0.24;
  for (let y = 0; y < res; y += 1) {
    const ny = (y + 0.5 - half) / half; // -1 .. 1
    for (let x = 0; x < res; x += 1) {
      const nx = (x + 0.5 - half) / half; // -1 .. 1
      const r = Math.hypot(nx, ny);
      const idx = (y * res + x) * 4;
      // Position within THIS nested lens: 0 at the centre, 1 at its own rim.
      // At/outside the rim the layer is neutral so it only bends its own disc;
      // successively smaller inner layers pile more refraction toward the core,
      // and each compounds the warp handed down from the layer before it.
      const localRadius = r / Math.max(1e-6, layerRadius);
      if (r < 1e-4 || localRadius >= 1) {
        data[idx] = 128;
        data[idx + 1] = 128;
      } else {
        const ease = clamp((1 - localRadius) / rimEase, 0, 1);
        const rimWindow = ease * ease * (3 - 2 * ease); // smoothstep -> 0 at rim
        const magnitude = refractMagnitude(localRadius, q) * rimWindow;
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
  const imageScale = Math.max(0.05, 1 + clamp(localStretch, -100, 300) / 100);
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
