import { airconUserModeIntent, isAirconMode } from "../aircon-control";
import type { Direction } from "./types";

/**
 * Which direction Manual runs, given the direction the owner seated.
 *
 * **Manual only ever does what the owner set, and nothing else** — inviolable
 * (alex, 2026-10-30, specs/aircon-auto-control.md §5.0). A seated direction is
 * the answer whatever the room or the target does, and nothing but the owner moves
 * it. Moving the target is never a direction change: Cool with a target raised
 * above the room is a floor the room may warm up to on its own, not a request to
 * heat it. On 2026-10-29 Manual showed Cool, the target went 22 -> 23 over a 22
 * degree room, and the loop ran the unit in heat — because nothing had been
 * seated, and this function let the room decide on every tick.
 *
 * So the room decides nothing here. With nothing seated there is no direction to
 * drive; `seatManualDirection` fills the seat once, and from then on this returns
 * it.
 */
export function manualAirconDirection(input: {
  /** The direction the owner seated (Manual's remembered direction), or null. */
  dictated: Direction | null;
  /** The direction the unit is physically running, or null. */
  running: Direction | null;
}): Direction | null {
  const seated = heatOrCool(input.dictated);
  if (seated) return seated;
  // Nothing seated, and the unit is running Dry or Fan-only: that is what it is
  // doing, started by whoever started it — report it, never drive it.
  if (input.running === "dry" || input.running === "fan_only") return input.running;
  return null;
}

/**
 * The direction to seat when Manual was selected without one — a bare `turn_on`,
 * an app that sends `mode: "manual"` alone, a state file from before the seat
 * existed. Called only while the seat is empty, and what it returns is stored, so
 * it is a one-time default and never a change: once seated, only the owner moves
 * it.
 *
 * In order: the heat, cool or dry the unit is already running (what she sees it
 * doing is what she selected); the side of the target the room is on; the direction
 * remembered in preferences. The remembered one comes last because Nova's own Auto
 * leg writes it (2026-09-24: a remembered cool beat a 21 degree room with a 27
 * degree target), and only over a reading that sits exactly on the target. Null
 * when none of them says.
 */
export function seatManualDirection(input: {
  running: Direction | null;
  measured: number | null;
  target: number | null;
  remembered: unknown;
}): Direction | null {
  const running = heatOrCool(input.running);
  if (running) return running;
  // A unit running Dry is doing what someone set: seat it as it is, never a
  // heat or cool chosen over it. (A thermostat park on fan only arrives here as
  // null — the caller does not pass it.)
  if (input.running === "dry") return "dry";
  const { measured, target } = input;
  const fromRoom = measured !== null && target !== null && Number.isFinite(target)
    ? airconUserModeIntent(target, measured)
    : undefined;
  if (fromRoom === "heat" || fromRoom === "cool") return fromRoom;
  // Only over a reading: with none, the remembered direction would be a guess
  // between heat and cool, which §5.2 forbids. The seat waits for the room.
  if (measured === null) return null;
  const { remembered } = input;
  return typeof remembered === "string" && isAirconMode(remembered) ? heatOrCool(remembered as Direction) : null;
}

/** Dry and fan-only are statuses of their own, never a direction to drive. */
function heatOrCool(direction: Direction | null): "heat" | "cool" | null {
  return direction === "heat" || direction === "cool" ? direction : null;
}
