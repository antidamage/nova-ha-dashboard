import { airconUserModeIntent } from "../aircon-control";
import type { Direction } from "./types";
import { MANUAL_AIRCON_DIRECTION_FLIP_MARGIN_C } from "./constants";

/**
 * Which direction Manual runs, decided by the room rather than by memory.
 *
 * Adeline, 2026-09-24: "if air con is off when user specified auto or manual and
 * the temp is out of homeostasis, air con unit SHOULD BE ON." The room is the
 * evidence for which way "on" means — below the target runs heat, above it runs
 * cool — and this is the one place that decision is made, so the UI's press and
 * the server loop cannot answer it differently.
 *
 * A remembered direction is not evidence. It describes the last time *something*
 * set it, and on this aircon that is usually Nova's own Auto leg: the Gree's
 * return-air thermistor heat-soaks above the target while the unit is off, Auto
 * reverses to cool on that transient, and `preferences.aircon.hvacMode` records
 * "cool" for the rest of the day. Reading that as the direction the owner
 * dictated is what turned her first press of Manual in a 21 °C room with a 27 °C
 * target into `set_hvac_mode: cool`, an immediate "target reached", and a
 * `turn_off` 41 ms later on 2026-09-24 — two beeps and a unit that never ran.
 * Arming Auto first appeared to fix it only because Auto's own arm rewrote the
 * remembered direction to heat from the room it could see.
 *
 * The dictation still holds while the room is on that direction's side of the
 * target, and within `MANUAL_AIRCON_DIRECTION_FLIP_MARGIN_C` past it: a thermostat
 * does not reverse over a degree of overshoot, and a resting unit keeps the light
 * showing the direction it just ran. Only past that margin, or with no direction
 * seated at all, does the room decide.
 */
export function manualAirconDirection(input: {
  /** The direction the owner last dictated (Manual's remembered direction), or null. */
  dictated: Direction | null;
  /** The direction the unit is physically running, or null. */
  running: Direction | null;
  /** The control reading — the median where the caller has one. */
  measured: number | null;
  target: number | null;
}): Direction | null {
  const { dictated, measured, running, target } = input;
  const seated = heatOrCool(dictated);
  if (seated) {
    if (measured === null || target === null || !Number.isFinite(target)) return seated;
    // Past the target on the other side, by more than the flip margin: the
    // dictation is describing a room that is no longer there.
    const stale = seated === "heat"
      ? measured > target + MANUAL_AIRCON_DIRECTION_FLIP_MARGIN_C
      : measured < target - MANUAL_AIRCON_DIRECTION_FLIP_MARGIN_C;
    if (!stale) return seated;
  }
  // Nothing dictates heat or cool, and the unit is running Dry or Fan-only: that
  // is what it is doing, started by whoever started it, and this loop drives only
  // heat and cool — so report it rather than proposing a direction for it. A Dry
  // the owner selected is handled by the caller, which has its own branch for it.
  if (seated === null && (running === "dry" || running === "fan_only")) return running;
  // No dictation, or a stale one: the room says which way, and where the room is
  // exactly on its target either direction has already arrived, so the direction
  // the unit is running is the one that can still stop it.
  const wanted = measured !== null && target !== null && Number.isFinite(target)
    ? airconUserModeIntent(target, measured)
    : undefined;
  return wanted ?? seated ?? heatOrCool(running);
}

/** Dry and fan-only are statuses of their own, never a direction to drive. */
function heatOrCool(direction: Direction | null): "heat" | "cool" | null {
  return direction === "heat" || direction === "cool" ? direction : null;
}
