// Apple TV swipe/stickiness tuning, shared between the /api/theme envelope (read
// live by the tvOS app) and the "Apple TV Expert Settings" config UI. This is the
// single source of truth for the defaults, the legal ranges, and the clamping —
// both the server route and the React control import from here so the slider
// bounds and the values the watch actually receives can never drift apart.
//
// The tvOS client mirrors these names/defaults in `SwipeSettings` (DashboardStore
// .swift); keep the two in sync when adding a knob.

export type AppleTvSwipeSettings = {
  /** Swipes-in-a-row needed to reverse one level *out* of the menu hierarchy. */
  hierarchyCharge: number;
  /** Swipes-in-a-row needed to cross between device groups (aircon ↔ heater). */
  componentGroupCharge: number;
  /** How long (ms) accumulated swipe "charge" survives between flicks before it resets. */
  resetMs: number;
  /** Minimum gap (ms) between accepted navigation moves. Lower = more sensitive. */
  moveIntervalMs: number;
  /** Dwell (ms) a control must be pushed before focus detaches from it. */
  detachMs: number;
  /** How far (px) the focused control rubber-bands as a "about to break free" hint. 0 = off. */
  nudgePx: number;
};

export const APPLETV_SWIPE_DEFAULTS: AppleTvSwipeSettings = {
  hierarchyCharge: 4,
  componentGroupCharge: 3,
  resetMs: 500,
  moveIntervalMs: 220,
  detachMs: 80,
  nudgePx: 14,
};

// Inclusive [min, max, step] for each knob, consumed by the config sliders.
export const APPLETV_SWIPE_RANGES = {
  hierarchyCharge: { min: 1, max: 8, step: 1 },
  componentGroupCharge: { min: 1, max: 8, step: 1 },
  resetMs: { min: 200, max: 1500, step: 50 },
  moveIntervalMs: { min: 100, max: 500, step: 10 },
  detachMs: { min: 0, max: 250, step: 10 },
  nudgePx: { min: 0, max: 48, step: 1 },
} as const satisfies Record<keyof AppleTvSwipeSettings, { min: number; max: number; step: number }>;

function clampField(field: keyof AppleTvSwipeSettings, value: unknown): number {
  const { min, max } = APPLETV_SWIPE_RANGES[field];
  const fallback = APPLETV_SWIPE_DEFAULTS[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const clamped = Math.min(max, Math.max(min, value));
  // Charge counts are whole swipes; everything else is a continuous magnitude.
  return field === "hierarchyCharge" || field === "componentGroupCharge"
    ? Math.round(clamped)
    : clamped;
}

/**
 * Coerces an arbitrary value into a fully-populated, in-range settings object,
 * filling any missing/invalid field from {@link APPLETV_SWIPE_DEFAULTS}. Always
 * returns every key so the API envelope and the watch never see a partial.
 */
export function normalizeAppleTvSwipe(value: unknown): AppleTvSwipeSettings {
  const source = (value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {});
  return {
    hierarchyCharge: clampField("hierarchyCharge", source.hierarchyCharge),
    componentGroupCharge: clampField("componentGroupCharge", source.componentGroupCharge),
    resetMs: clampField("resetMs", source.resetMs),
    moveIntervalMs: clampField("moveIntervalMs", source.moveIntervalMs),
    detachMs: clampField("detachMs", source.detachMs),
    nudgePx: clampField("nudgePx", source.nudgePx),
  };
}

/**
 * Parses a partial update (only the keys the caller actually changed), returning
 * `undefined` when nothing valid was supplied so callers can skip the write.
 */
export function appleTvSwipeUpdateFrom(value: unknown): Partial<AppleTvSwipeSettings> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const next: Partial<AppleTvSwipeSettings> = {};
  for (const key of Object.keys(APPLETV_SWIPE_RANGES) as (keyof AppleTvSwipeSettings)[]) {
    const raw = source[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      next[key] = clampField(key, raw);
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}
