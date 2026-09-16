// Status Orb module format: colour-reference and gradient normalizers.

import { HEX_COLOR_PATTERN, ORB_THEME_SLOTS } from "./constants";
import type {
  OrbColorRef,
  OrbGradientStop,
  OrbInnerShadow,
  OrbLinearGradient,
  OrbThemeSlot,
} from "./types";
import { clampedNum, recordValue } from "./value-model";

function isThemeSlot(value: unknown): value is OrbThemeSlot {
  return typeof value === "string" && (ORB_THEME_SLOTS as readonly string[]).includes(value);
}

/**
 * Normalize a color reference. Invalid refs degrade to opaque white rather
 * than failing the whole module — a wrong color is visible and debuggable,
 * a missing orb is not.
 */
export function normalizeOrbColorRef(value: unknown): OrbColorRef {
  const v = recordValue(value) ?? {};
  const ref: OrbColorRef = {};
  if (isThemeSlot(v.theme)) {
    ref.theme = v.theme;
  } else if (typeof v.hex === "string" && HEX_COLOR_PATTERN.test(v.hex)) {
    ref.hex = v.hex.toLowerCase();
  } else {
    ref.hex = "#ffffff";
  }
  if (v.alpha !== undefined) {
    ref.alpha = clampedNum(v.alpha, 1, 0, 1);
  }
  if (isThemeSlot(v.alertTheme)) {
    ref.alertTheme = v.alertTheme;
  }
  return ref;
}

/** Normalize a gradient stop list: clamp positions, sort ascending. */
export function normalizeStops(value: unknown): OrbGradientStop[] {
  const list = Array.isArray(value) ? value : [];
  const stops = list
    .map((entry) => {
      const v = recordValue(entry);
      if (!v) return null;
      return {
        at: clampedNum(v.at, 0, 0, 1),
        color: normalizeOrbColorRef(v.color),
      };
    })
    .filter((stop): stop is OrbGradientStop => stop !== null)
    .sort((a, b) => a.at - b.at);
  // A gradient needs at least one stop to mean anything; default to white so
  // a malformed layer is visible rather than silently invisible.
  return stops.length > 0 ? stops : [{ at: 0, color: { hex: "#ffffff" } }];
}

/** A ring's linear-gradient paint; dropped whole when it has no stops. */
export function normalizeLinearGradient(value: unknown): OrbLinearGradient | undefined {
  const v = recordValue(value);
  if (!v) return undefined;
  // normalizeStops never returns empty — it falls back to white so a malformed
  // gradient is visible. Here that would repaint the ring, so a gradient with
  // no stops of its own is dropped instead and the flat `color` stands.
  if (!Array.isArray(v.stops) || v.stops.length === 0) return undefined;
  return { angle: clampedNum(v.angle, 0, -720, 720), stops: normalizeStops(v.stops) };
}

/** A ring's inset shadow; dropped when the blur is nothing. */
export function normalizeInnerShadow(value: unknown): OrbInnerShadow | undefined {
  const v = recordValue(value);
  if (!v) return undefined;
  const blur = clampedNum(v.blur, 0, 0, 2);
  if (blur <= 0) return undefined;
  return { blur, color: normalizeOrbColorRef(v.color) };
}
