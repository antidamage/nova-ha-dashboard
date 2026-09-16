// Repeat and follow-on bounds, shared by the schedule and normalisation models.

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const MIN_REPEAT_DAYS = 1;
export const MAX_REPEAT_DAYS = 365;
export const MAX_FOLLOW_OFFSET_DAYS = 365;
// Local hour a completed day-interval reminder comes back at.
export const REPEAT_MORNING_HOUR = 7;
