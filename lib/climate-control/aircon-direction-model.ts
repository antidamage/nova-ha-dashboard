import { isAirconMode } from "../aircon-control";
import type { AirconPreferences } from "../types";
import { manualAirconDirection } from "./manual-direction-model";
import type { Direction } from "./types";

/**
 * Which direction this tick reports, and — in Manual — drives.
 *
 * Split out of `drive-aircon.ts` (specs/agent-token-footprint.md §3.3) so the
 * decision is one readable function rather than an expression inside the tick.
 *
 * The rules it holds together:
 *
 * - Dry and fan-only are statuses of their own, with their own branch in the
 *   tick; they are never a direction to drive.
 * - Auto reports what the unit is doing, falling back to the last direction
 *   anyone asked for. Only reporting: Auto's planner chooses its own direction.
 * - Manual asks `manualAirconDirection`, which runs the direction she seated.
 *   The room answers only when nothing is seated. What the
 *   owner seated is passed as the dictation and nothing else is — in particular
 *   not `prefs.hvacMode`, which Nova's own Auto leg writes. Feeding that in made
 *   it evidence: it chose a direction with no reading to check it against
 *   (2026-09-24 review of #47). The margin that once let the room overrule a seat
 *   is gone (2026-09-25).
 */
export function airconTickDirection(input: {
  filteredTemperature: number | null;
  mode: "auto" | "manual" | "off";
  preferences?: AirconPreferences;
  rawTemperature: number | null;
  /** The direction the unit is physically running, or null. */
  running: Direction | null;
  /** The direction the owner seated in Manual, or null. */
  seated: Direction | null;
  target: number | null;
}): Direction | null {
  if (input.seated === "dry" || input.seated === "fan_only") return input.seated;
  if (input.mode !== "manual") {
    return input.running ?? rememberedDirection(input.preferences);
  }
  return manualAirconDirection({
    dictated: input.seated,
    measured: input.filteredTemperature ?? input.rawTemperature,
    running: input.running,
    target: input.target,
  });
}

/** The last direction anyone asked for. Reported for Auto, never evidence. */
function rememberedDirection(preferences?: AirconPreferences): Direction | null {
  const mode = preferences?.hvacMode;
  return isAirconMode(mode) && mode !== "auto" ? (mode as Direction) : null;
}
