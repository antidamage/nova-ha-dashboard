import type { AirconPreferences } from "../types";
import type { Direction } from "./types";

const DIRECTIONS: Direction[] = ["heat", "cool", "dry", "fan_only"];

const asDirection = (value: unknown): Direction | null =>
  typeof value === "string" && DIRECTIONS.includes(value as Direction) ? (value as Direction) : null;

/** What one legacy HA action says about the owner's mode switch, if anything. */
export type AirconActionIntent = {
  mode: "auto" | "manual" | "off" | null;
  manualDirection: Direction | null;
};

/**
 * Read an `/api/entity` climate action as a statement about the air
 * conditioner's mode and the direction Manual should run.
 *
 * This path carries actions from every caller — the dashboard cards, voice,
 * automations, MCP — so it is where the mode is recorded. It is kept pure and
 * separate from applying it because getting it wrong is how the modes drift:
 * Manual rests the unit at target and must still read as Manual afterwards, and
 * Auto arms itself with a set_hvac_mode that must not read as Manual at all
 * (Adeline, 2026-09-19; specs/aircon-auto-control.md §5).
 *
 * Returns the state as it should be after the action: `mode: null` means the
 * action says nothing about the mode and the stored one stands.
 */
export function airconLegacyActionIntent(input: {
  service: string;
  /** `action.data.hvac_mode` — a direction, or "off". */
  hvacMode?: unknown;
  /** `action.remember?.aircon`, the caller's explicit statement of intent. */
  remembered?: AirconPreferences;
  /** The entity's state as read before the action went out. */
  unitState?: string;
  storedMode: "auto" | "manual" | "off" | null;
  storedDirection: Direction | null;
}): AirconActionIntent {
  const { service, remembered, storedMode, storedDirection } = input;
  const autoMode = remembered?.autoMode;
  const commandedDirection = asDirection(input.hvacMode);

  // `remember` is the explicit statement and wins: arming Auto sends a
  // set_hvac_mode of its own, which would otherwise read as Manual.
  let mode: AirconActionIntent["mode"] = null;
  if (autoMode === true) mode = "auto";
  else if (autoMode === false) mode = "manual";
  else if (service === "set_hvac_mode") mode = input.hvacMode === "off" ? "off" : "manual";
  // Auto drives the unit on with a bare turn_on of its own, so a turn_on that
  // says nothing about the mode must not demote Auto to Manual.
  else if (service === "turn_on" && storedMode !== "auto") mode = "manual";

  let manualDirection = storedDirection;
  if (autoMode === true) manualDirection = null;
  // Any set_hvac_mode that is not Auto arming itself names the direction Manual
  // should run — including a bare one from voice, an automation or MCP, which
  // carries no `remember` and so used to leave Manual with no direction and
  // nothing to restart on.
  if (service === "set_hvac_mode" && autoMode !== true && commandedDirection) {
    manualDirection = commandedDirection;
  }
  if (autoMode === false && manualDirection === null) {
    const running = input.unitState;
    if (running === "heat" || running === "cool" || running === "fan_only") manualDirection = running;
  }
  // Every turn_off ends Manual, whoever sent it: a remembered direction would
  // otherwise let the loop start the unit again. Auto's own rest at target sends
  // turn_off carrying autoMode:true — that is the loop resting the compressor,
  // not the owner choosing Off.
  if (service === "turn_off") {
    manualDirection = null;
    if (autoMode !== true) mode = "off";
  }

  return { mode, manualDirection };
}
