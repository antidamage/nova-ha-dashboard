import type { ClimateControlMode } from "../types";
import type { Direction } from "./types";

/**
 * Which of Auto / Manual / Off an air conditioner is in.
 *
 * Adeline, 2026-09-19: "the auto/manual/mode toggle is a switch that the user
 * sets, nobody else. if it's set to manual then it has to stay on and continue
 * running the manual rules." Manual is a thermostat of its own — it starts the
 * unit to reach the target and switches it off again on arrival — so a unit
 * resting at target says nothing about which mode is selected. Reading the
 * selection off the unit's power, as this used to, cancelled Manual on the first
 * tick after it reached the target, which on a room already at temperature was
 * the tick right after she pressed it.
 *
 * `storedMode` is therefore the authority. The rest is the legacy inference,
 * still needed for a state file written before the controller recorded a mode.
 */
export function airconControlMode(input: {
  storedMode: ClimateControlMode | null;
  autoMode: boolean | undefined;
  manualDirection: Direction | null;
  unitOn: boolean;
}): ClimateControlMode {
  // Auto lives in preferences, which every client writes; it stays ahead of the
  // stored mode on the tick a press lands.
  if (input.autoMode) return "auto";
  // A recorded selection is the answer, including "off" over a unit Home
  // Assistant still reports as running: that is a turn_off the device has not
  // acknowledged yet, not a mode. Someone working the unit itself takes
  // ownership away from Nova instead, and the caller reports that separately.
  if (input.storedMode === "manual" || input.storedMode === "off") return input.storedMode;
  if (input.manualDirection || input.unitOn) return "manual";
  return "off";
}
