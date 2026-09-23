export const POLL_MS = 5_000;
export const COMMAND_SETTLE_MS = 12_000;
export const AIRCON_SAME_DIRECTION_RESUME_DRIFT_C = 1;
export const AIRCON_MIN_OFF_MS = 10 * 60_000;
export const AIRCON_START_WINDOW_MS = 60 * 60_000;

/**
 * How far past its target the room must be before Manual reverses the direction
 * the owner dictated (manual-direction-model.ts).
 *
 * Inside this band the dictation holds: a thermostat does not flip over a degree
 * of overshoot, and the unit resting with its light showing the direction it just
 * ran is the documented behaviour (specs/aircon-auto-control.md §5.1). Past it the
 * dictation is describing a room that is no longer there — which is what a
 * remembered direction is, because Nova's own Auto leg writes it (Adeline,
 * 2026-09-24: "it was already set to heat when I first tried it. it's winter, I
 * never set it to cool" — while the stored direction was cool, from the Gree's
 * heat-soaked thermistor reading above the target hours earlier) — and the room
 * decides instead.
 */
export const MANUAL_AIRCON_DIRECTION_FLIP_MARGIN_C = 1;
