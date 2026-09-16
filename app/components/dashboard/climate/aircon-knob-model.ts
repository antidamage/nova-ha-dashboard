import { isClimateEntityOn, type AirconMode } from "../../../../lib/aircon-control";
import type { DashboardEntity } from "../../../../lib/types";
import {
  MODE_COOL_COLOUR,
  MODE_DRY_COLOUR,
  MODE_FAN_COLOUR,
  MODE_HEAT_COLOUR,
} from "../../temperatureEncoderModel";

export type ModeStop = { mode: AirconMode; colour: string; text: string; label: string };

/**
 * Left to right: Cool, Dry, Fan, Heat. Dry is a stop only when the unit has it
 * or Nova can emulate it; otherwise three stops (specs/temperature-encoder.md,
 * round 2).
 */
export const MODE_STOPS_ALL: ReadonlyArray<ModeStop> = [
  { mode: "cool", colour: MODE_COOL_COLOUR, text: "COOL", label: "Cooling" },
  { mode: "dry", colour: MODE_DRY_COLOUR, text: "DRY", label: "Dry" },
  { mode: "fan_only", colour: MODE_FAN_COLOUR, text: "FAN", label: "Fan" },
  { mode: "heat", colour: MODE_HEAT_COLOUR, text: "HEAT", label: "Heating" },
];
export const MODE_STOPS_NO_DRY = MODE_STOPS_ALL.filter((stop) => stop.mode !== "dry");
export const MODE_VALUE_WIDEST = "HEAT";

/** What the aircon's entity says about its range, or the usual 16–30. */
export function targetRange(entity?: DashboardEntity) {
  const min = Number(entity?.attributes?.min_temp);
  const max = Number(entity?.attributes?.max_temp);
  return {
    min: Number.isFinite(min) ? min : 16,
    max: Number.isFinite(max) ? max : 30,
  };
}

/** Running means the ring glows: heating, cooling or moving air right now. */
export function airconRunning(entity: DashboardEntity | undefined, powerOff: boolean) {
  if (!entity || powerOff) return false;
  return ["heat", "cool", "fan_only", "dry"].includes(entity.state) && isClimateEntityOn(entity);
}
