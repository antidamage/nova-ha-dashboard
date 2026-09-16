import { HEX_COLOR_PATTERN } from "./constants";
import type { OrbColorRef, OrbThemeSlot } from "./types";
import { clamp } from "./value-model";

// ---------------------------------------------------------------------------
// Color resolution
// ---------------------------------------------------------------------------
//
// Renderers don't read the avatar theme directly; the host component builds
// an OrbPalette (one resolved rgb+alpha per theme slot) each frame and the
// renderer resolves layer color refs against it. Keeping this math here means
// the web renderer, the tvOS port, and the tests all share one definition of
// "what color does this ref produce".

/** A concrete color: 0-255 rgb channels plus a 0..1 alpha. */
export type OrbResolvedColor = { rgb: [number, number, number]; alpha: number };

/** Every theme slot resolved to a concrete color for the current frame. */
export type OrbPalette = Record<OrbThemeSlot, OrbResolvedColor>;

/** Parse #rgb or #rrggbb into an rgb tuple; invalid input yields white. */
export function hexToRgb(hex: string): [number, number, number] {
  if (!HEX_COLOR_PATTERN.test(hex)) return [255, 255, 255];
  const raw = hex.slice(1);
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Linear rgb mix used by the alert pulse (matches the old mixRgb helper). */
function mixChannel(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

/**
 * Resolve a color ref to a concrete color.
 *
 * `alertPulse` is the 0..1 alert oscillation (0 whenever the alert is
 * inactive); when the ref carries `alertTheme`, the resolved color is mixed
 * toward that slot's color by the pulse value — exactly how the classic orb's
 * outer gradient throbs toward the alert color.
 */
export function resolveOrbColor(
  ref: OrbColorRef,
  palette: OrbPalette,
  alertPulse: number,
): OrbResolvedColor {
  const base: OrbResolvedColor = ref.theme
    ? palette[ref.theme]
    : { rgb: hexToRgb(ref.hex ?? "#ffffff"), alpha: 1 };

  let rgb = base.rgb;
  let alpha = base.alpha;
  if (ref.alertTheme && alertPulse > 0) {
    const alert = palette[ref.alertTheme];
    rgb = [
      mixChannel(rgb[0], alert.rgb[0], alertPulse),
      mixChannel(rgb[1], alert.rgb[1], alertPulse),
      mixChannel(rgb[2], alert.rgb[2], alertPulse),
    ];
    alpha = alpha + (alert.alpha - alpha) * alertPulse;
  }
  if (ref.alpha !== undefined) {
    alpha *= ref.alpha;
  }
  return { rgb, alpha: clamp(alpha, 0, 1) };
}
