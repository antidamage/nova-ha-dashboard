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
 * - Manual runs the direction she seated and nothing else — not the room, not
 *   the target, and not `prefs.hvacMode`, which Nova's own Auto leg writes
 *   (spec §5.0, inviolable). The tick seats an empty Manual once before asking
 *   (`seatManualDirection`); this only reads the seat.
 */
export function airconTickDirection(input: {
  mode: "auto" | "manual" | "off";
  preferences?: AirconPreferences;
  /** The direction the unit is physically running, or null. */
  running: Direction | null;
  /** The direction the owner seated in Manual, or null. */
  seated: Direction | null;
}): Direction | null {
  if (input.seated === "dry" || input.seated === "fan_only") return input.seated;
  if (input.mode !== "manual") {
    return input.running ?? rememberedDirection(input.preferences);
  }
  return manualAirconDirection({ dictated: input.seated, running: input.running });
}

/** The last direction anyone asked for. Reported for Auto, never evidence. */
function rememberedDirection(preferences?: AirconPreferences): Direction | null {
  const mode = preferences?.hvacMode;
  return isAirconMode(mode) && mode !== "auto" ? (mode as Direction) : null;
}
