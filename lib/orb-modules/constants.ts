// Status Orb module format: literal tables and defaults. Types derived from
// these are in ./types; the package surface is ../orb-modules.ts.

/**
 * Theme color slots a module layer may reference. These are the existing
 * Status Orb theme colors (see `avatarThemeModel.ts`), so every module —
 * regardless of its layer stack — recolors itself from the same user-edited
 * theme values:
 *   - gradientCenter / gradientOuter: the orb background gradient pair.
 *   - gradientAlert: the gym-overdue alert color (used as a pulse target).
 *   - line1/line2/line3: the three arc colors. Their per-line 0-100 theme
 *     opacities are baked into the resolved palette alpha.
 *   - gymNumber: the gym counter color (with its theme opacity baked in).
 *   - innerShadow: black at the theme's `innerShadowOpacity` — the orb's
 *     dark bevel/vignette strength, exposed as a color so modules can reuse it.
 */
export const ORB_THEME_SLOTS = [
  "gradientCenter",
  "gradientOuter",
  "gradientAlert",
  "line1",
  "line2",
  "line3",
  "gymNumber",
  "innerShadow",
] as const;

/**
 * Cross-platform blend modes. Each maps directly to a canvas composite op and
 * a CGBlendMode, so renderers never need to emulate blending:
 *   normal   -> "source-over" / .normal
 *   additive -> "lighter"     / .plusLighter
 *   screen   -> "screen"      / .screen
 *   multiply -> "multiply"    / .multiply
 */
export const ORB_BLEND_MODES = ["normal", "additive", "screen", "multiply"] as const;

/** Current module format version; bump when the schema changes shape. */
export const ORB_MODULE_FORMAT_VERSION = 1;

/** The id every renderer falls back to when a referenced module is missing. */
export const FALLBACK_ORB_MODULE_ID = "classic";

export const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
