// Apple TV swipe feel, shared between the /api/theme envelope (read live by the
// tvOS app) and the "Apple TV Expert Settings" config UI. This is the single
// source of truth for the defaults, the legal ranges, and the clamping — both
// the server route and the React control import from here so the slider bounds
// and the values the TV actually receives can never drift apart.
//
// The tvOS client mirrors these names/defaults in `SwipeSettings`
// (NovaAppleTVDashboard/SwipeSettings.swift); keep the two in sync when adding
// a knob. Distances are percentages of the remote's touch-pad width.

export type AppleTvSwipeSettings = {
  /** Travel (% of pad) for the first step of a touch. */
  firstStepPct: number;
  /** Further travel (% of pad) for each extra step in the same touch. */
  nextStepPct: number;
  /** First-step travel when the touch follows a same-direction step within 350 ms. */
  flowFirstStepPct: number;
  /** Multiplier on the travel needed to cross into another column of the band. */
  boundaryResistance: number;
  /** Unlocked dial, up/down: travel (% of pad) per value step. */
  adjustStepPct: number;
  /** Lift speed (pad widths/s) at which a short touch counts as a flick step. */
  flickSpeed: number;
  /** Extra lift speed (pad widths/s) needed for each coasted item. */
  coastSpeedPerItem: number;
  /** Most items a flick may coast after lift. 0 = no coasting. */
  coastMax: number;
  /** How far (px) the focused control leans toward the swipe. 0 = off. */
  nudgePx: number;
  /** Clickpad edge press held: delay (ms) before the first repeat. */
  holdDelayMs: number;
  /** Clickpad edge press held: time (ms) between repeats. */
  repeatMs: number;
};

export const APPLETV_SWIPE_DEFAULTS: AppleTvSwipeSettings = {
  firstStepPct: 27,
  nextStepPct: 43,
  flowFirstStepPct: 20,
  boundaryResistance: 1.3,
  adjustStepPct: 15,
  flickSpeed: 1.5,
  coastSpeedPerItem: 1.5,
  coastMax: 2,
  nudgePx: 14,
  holdDelayMs: 450,
  repeatMs: 180,
};

// Inclusive [min, max, step] for each knob, consumed by the config sliders.
export const APPLETV_SWIPE_RANGES = {
  firstStepPct: { min: 10, max: 60, step: 1 },
  nextStepPct: { min: 20, max: 90, step: 1 },
  flowFirstStepPct: { min: 5, max: 60, step: 1 },
  boundaryResistance: { min: 1, max: 2, step: 0.05 },
  adjustStepPct: { min: 5, max: 40, step: 1 },
  flickSpeed: { min: 0.5, max: 4, step: 0.1 },
  coastSpeedPerItem: { min: 0.5, max: 4, step: 0.1 },
  coastMax: { min: 0, max: 4, step: 1 },
  nudgePx: { min: 0, max: 48, step: 1 },
  holdDelayMs: { min: 200, max: 800, step: 10 },
  repeatMs: { min: 100, max: 500, step: 10 },
} as const satisfies Record<keyof AppleTvSwipeSettings, { min: number; max: number; step: number }>;

function clampField(field: keyof AppleTvSwipeSettings, value: unknown): number {
  const { min, max } = APPLETV_SWIPE_RANGES[field];
  const fallback = APPLETV_SWIPE_DEFAULTS[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const clamped = Math.min(max, Math.max(min, value));
  // The coast cap counts whole items; everything else is a continuous magnitude,
  // kept to two decimals so a slider's float arithmetic (1.1500000000000001)
  // never reaches storage, the API or the readout.
  return field === "coastMax" ? Math.round(clamped) : Math.round(clamped * 100) / 100;
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
    firstStepPct: clampField("firstStepPct", source.firstStepPct),
    nextStepPct: clampField("nextStepPct", source.nextStepPct),
    flowFirstStepPct: clampField("flowFirstStepPct", source.flowFirstStepPct),
    boundaryResistance: clampField("boundaryResistance", source.boundaryResistance),
    adjustStepPct: clampField("adjustStepPct", source.adjustStepPct),
    flickSpeed: clampField("flickSpeed", source.flickSpeed),
    coastSpeedPerItem: clampField("coastSpeedPerItem", source.coastSpeedPerItem),
    coastMax: clampField("coastMax", source.coastMax),
    nudgePx: clampField("nudgePx", source.nudgePx),
    holdDelayMs: clampField("holdDelayMs", source.holdDelayMs),
    repeatMs: clampField("repeatMs", source.repeatMs),
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
