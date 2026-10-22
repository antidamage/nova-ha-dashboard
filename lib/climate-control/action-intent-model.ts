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
 * **Only an action aimed at the unit itself, or one that says so explicitly in
 * its `remember`, speaks about the mode.** Every service aimed at something else
 * is somebody working something else, and must leave the selection alone:
 * Adeline, 2026-09-24 — "user selected mode should never be unset by any
 * process, ever." The case that broke that was the aircon's own companion
 * controls: its quiet-mode switch is resolved to the same instance by name, so a
 * `turn_off` from a Manual press's own fan-setting housekeeping
 * (useAirconCommands' setOn) read as the owner choosing Off, and the Manual she
 * had just pressed went out on its own.
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
  /**
   * The action is aimed at this instance's own climate entity. False for a
   * companion switch (quiet / fresh air / xtra fan) that merely resolved here.
   */
  speaksForTheUnit: boolean;
  storedMode: "auto" | "manual" | "off" | null;
  storedDirection: Direction | null;
}): AirconActionIntent {
  const { service, remembered, storedMode, storedDirection } = input;
  const autoMode = remembered?.autoMode;
  const commandedDirection = asDirection(input.hvacMode);
  /**
   * Whether this action says anything about the selection at all. `remember` is
   * an explicit statement from a climate-aware caller, so `autoMode` being
   * present counts even on a companion control — that is how choosing a fan
   * speed by hand leaves Auto.
   */
  const speaksAboutMode = input.speaksForTheUnit || autoMode !== undefined;

  // `remember` is the explicit statement and wins: arming Auto sends a
  // set_hvac_mode of its own, which would otherwise read as Manual.
  let mode: AirconActionIntent["mode"] = null;
  if (autoMode === true) mode = "auto";
  else if (autoMode === false) mode = "manual";
  else if (speaksAboutMode && service === "set_hvac_mode") mode = input.hvacMode === "off" ? "off" : "manual";
  // Auto drives the unit on with a bare turn_on of its own, so a turn_on that
  // says nothing about the mode must not demote Auto to Manual.
  else if (speaksAboutMode && service === "turn_on" && storedMode !== "auto") mode = "manual";

  let manualDirection = storedDirection;
  if (autoMode === true) manualDirection = null;
  // Any set_hvac_mode that is not Auto arming itself names the direction Manual
  // should run — including a bare one from voice, an automation or MCP, which
  // carries no `remember` and so used to leave Manual with no direction and
  // nothing to restart on.
  if (speaksAboutMode && service === "set_hvac_mode" && autoMode !== true && commandedDirection) {
    manualDirection = commandedDirection;
  }
  if (autoMode === false && manualDirection === null) {
    const running = input.unitState;
    if (running === "heat" || running === "cool") manualDirection = running;
    // With Auto or Manual selected, a unit on fan only is the thermostat's own
    // park (specs/aircon-auto-control.md §8), not the owner choosing Fan. Seating
    // it would leave Manual driving nothing.
    else if (running === "fan_only" && storedMode !== "auto" && storedMode !== "manual") manualDirection = running;
  }
  // A turn_off ends Manual only when it is aimed at the unit itself: a remembered
  // direction would otherwise let the loop start the unit again. Auto's own rest
  // at target sends turn_off carrying autoMode:true — that is the loop resting the
  // compressor, not the owner choosing Off.
  //
  // This test is deliberately stricter than speaksAboutMode. An explicit
  // `autoMode` on a companion control still means "leave Auto" — it does NOT mean
  // Off, because the press's `remember` rides whichever action happened to be
  // last. Choosing the fan step *low* while quiet mode is on sends no
  // `set_fan_mode` at all (the unit is already on `low`), so that remember lands
  // on the quiet switch's `turn_off`
  // (`airconFanStepActions`, lib/aircon-control/action-model.ts), and reading it
  // as Off unset the mode on an ordinary knob press — the same harm this file's
  // speaksForTheUnit gate exists to stop.
  if (service === "turn_off" && input.speaksForTheUnit) {
    manualDirection = null;
    if (autoMode !== true) mode = "off";
  }

  return { mode, manualDirection };
}
