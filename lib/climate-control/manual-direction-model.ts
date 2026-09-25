import { airconUserModeIntent } from "../aircon-control";
import type { Direction } from "./types";

/**
 * Which direction Manual runs, given the direction the owner seated.
 *
 * Adeline, 2026-09-24: "if air con is off when user specified auto or manual and
 * the temp is out of homeostasis, air con unit SHOULD BE ON." The room is the
 * evidence for which way "on" means — below the target runs heat, above it runs
 * cool — and this is the one place that decision is made, so the UI's press and
 * the server loop cannot answer it differently.
 *
 * A direction the owner seated is the answer, and nothing else moves it. The seat
 * is her mode: it is what maintains the temperature once the room arrives on its
 * own, so a target she moves must not move it (Adeline, 2026-09-25: "if the mode
 * is set to heat and I set a temp below the room temp … check that it doesn't
 * change the mode on me. if the mode is wrong for the desired outcome already
 * then that's user error and not for the app to fix"). The room names a direction
 * only when nothing is seated.
 *
 * The room used to overrule a seat once it sat more than
 * `MANUAL_AIRCON_DIRECTION_FLIP_MARGIN_C` (1 °C) past the target, and that made
 * every target change a mode change: heat seated with a 21 °C target in a 25 °C
 * room read as "the room wants cooling", Nova ran `climate.c6780cad` in cool, and
 * pressing Heat again was undone by the loop within one tick (2026-09-25).
 *
 * A remembered direction is still not evidence, so `dictated` is only ever the
 * direction the owner seated (§5.3): `preferences.aircon.hvacMode` is written by
 * Nova's own Auto leg, and reading it as the dictation is what turned a press of
 * Manual in a 21 °C room with a 27 °C target into `set_hvac_mode: cool` and a
 * `turn_off` 41 ms later on 2026-09-24.
 */
export function manualAirconDirection(input: {
  /** The direction the owner seated (Manual's remembered direction), or null. */
  dictated: Direction | null;
  /** The direction the unit is physically running, or null. */
  running: Direction | null;
  /** The control reading — the median where the caller has one. */
  measured: number | null;
  target: number | null;
}): Direction | null {
  const { dictated, measured, running, target } = input;
  const seated = heatOrCool(dictated);
  // Her seat is the answer, whatever the room is doing — including a room that
  // has gone past the target the other way, which is a room arriving on its own.
  if (seated) return seated;
  // Nothing is seated, and the unit is running Dry or Fan-only: that is what it
  // is doing, started by whoever started it, and this loop drives only heat and
  // cool — so report it rather than proposing a direction for it. A Dry the
  // owner selected is handled by the caller, which has its own branch for it.
  if (running === "dry" || running === "fan_only") return running;
  // Nothing seated: the room says which way, and where the room is exactly on
  // its target either direction has already arrived, so the direction the unit
  // is running is the one that can still stop it.
  const wanted = measured !== null && target !== null && Number.isFinite(target)
    ? airconUserModeIntent(target, measured)
    : undefined;
  return wanted ?? heatOrCool(running);
}

/** Dry and fan-only are statuses of their own, never a direction to drive. */
function heatOrCool(direction: Direction | null): "heat" | "cool" | null {
  return direction === "heat" || direction === "cool" ? direction : null;
}
