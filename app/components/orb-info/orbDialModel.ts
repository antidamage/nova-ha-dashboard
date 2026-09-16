/**
 * Status orb dial state (specs/status-orb-stack.md, Round 2 "The dial").
 * Pure: every transition takes `now`, so the timings are unit-testable.
 */

export const ORB_DIAL_DEFOCUS_MS = 5_000;
export const ORB_DIAL_RETURN_MS = 10_000;
export const ORB_DIAL_SLIDE_MS = 220;
/** Degrees of turn per entry; a long stack shares the 270-degree arc. */
export const ORB_DIAL_MAX_DETENT_DEG = 45;
export const ORB_DIAL_ARC_DEG = 270;

export type OrbDialState = {
  open: boolean;
  /**
   * The entry on show, by entry id; null = the top entry. Tracking the id (not
   * an index) keeps the same entry on show when the stack reorders under it.
   */
  shownId: string | null;
  /** +1 slid toward lower priority, -1 toward the top; drives the slide. */
  direction: 1 | -1;
  lastTouchAt: number;
};

export const ORB_DIAL_INITIAL: OrbDialState = { open: false, shownId: null, direction: 1, lastTouchAt: 0 };

export type OrbDialAction =
  | { type: "open"; now: number }
  | { type: "close" }
  | { type: "step"; delta: number; ids: readonly string[]; now: number }
  | { type: "touch"; now: number }
  | { type: "tick"; now: number };

/** Index of the entry on show within the current ordered stack; a vanished entry falls back to the top. */
export function orbDialIndex(state: OrbDialState, ids: readonly string[]): number {
  if (state.shownId === null) return 0;
  return Math.max(0, ids.indexOf(state.shownId));
}

export function orbDialReducer(state: OrbDialState, action: OrbDialAction): OrbDialState {
  switch (action.type) {
    case "open":
      return { ...state, open: true, lastTouchAt: action.now };
    case "close":
      return state.open ? { ...state, open: false } : state;
    case "touch":
      return { ...state, lastTouchAt: action.now };
    case "step": {
      const from = orbDialIndex(state, action.ids);
      const index = clampIndex(from + Math.trunc(action.delta), action.ids.length);
      if (index === from) return { ...state, lastTouchAt: action.now };
      return { ...state, shownId: index === 0 ? null : action.ids[index], direction: index > from ? 1 : -1, lastTouchAt: action.now };
    }
    case "tick": {
      let next = state;
      const idle = action.now - state.lastTouchAt;
      if (next.open && idle >= ORB_DIAL_DEFOCUS_MS) next = { ...next, open: false };
      if (next.shownId !== null && idle >= ORB_DIAL_RETURN_MS) next = { ...next, shownId: null, direction: -1 };
      return next;
    }
  }
}

export function clampIndex(index: number, count: number): number {
  return Math.max(0, Math.min(Math.max(0, count - 1), index));
}

/** Degrees of drag per entry for a stack of `count`. */
export function orbDialDetentDeg(count: number): number {
  return count <= 1 ? ORB_DIAL_MAX_DETENT_DEG : Math.min(ORB_DIAL_MAX_DETENT_DEG, ORB_DIAL_ARC_DEG / (count - 1));
}

/** Position mark angle, clockwise from 12 o'clock, over a -135..135 arc. */
export function orbDialMarkAngle(index: number, count: number): number {
  if (count <= 1) return 0;
  const span = orbDialDetentDeg(count) * (count - 1);
  return -span / 2 + orbDialDetentDeg(count) * index;
}

/** Signed shortest sweep between two angles in degrees. */
export function angleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > 180) delta -= 360;
  while (delta <= -180) delta += 360;
  return delta;
}

/** When the next timed transition is due, or null when none is pending. */
export function orbDialNextDeadline(state: OrbDialState): number | null {
  if (state.open) return state.lastTouchAt + ORB_DIAL_DEFOCUS_MS;
  if (state.shownId !== null) return state.lastTouchAt + ORB_DIAL_RETURN_MS;
  return null;
}
