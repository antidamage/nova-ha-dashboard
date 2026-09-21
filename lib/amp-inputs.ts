import type { AmpPowerControlConfig } from "./config-schema";
import type { HaState } from "./types";

/**
 * The amp controller's inputs, as plain values: what the Apple TV asks for
 * (its power state), and what the plug actually reads.
 *
 * Split out of `lib/amp-power-control.ts` so that loop stays small — it does
 * IO and nothing else, and everything here is testable without a timer or a
 * Home Assistant. See specs/amp-appletv-power.md §1.1.
 */

export type AmpSwitchState = "on" | "off";

/** Desired amp state from the media player's state string (§1.1). */
export function desiredFromSource(
  state: string | undefined,
  offStates: readonly string[],
): AmpSwitchState | null {
  if (!state || state === "unavailable" || state === "unknown") {
    return null;
  }
  return offStates.includes(state) ? "off" : "on";
}

/**
 * The plug, as one state. Twins are the same socket, so any id reading `on`
 * means the socket is on; `off` only when something says so and nothing
 * contradicts it (lib/ha/twins.ts).
 */
export function switchStateOf(
  entityIds: readonly string[],
  statesById: Map<string, HaState>,
): AmpSwitchState | null {
  let sawOff = false;
  for (const entityId of entityIds) {
    const state = statesById.get(entityId)?.state;
    if (state === "on") return "on";
    if (state === "off") sawOff = true;
  }
  return sawOff ? "off" : null;
}

/** Both Apple TV conditions, read from the states the loop already fetched. */
export function desiredFromStates(
  config: AmpPowerControlConfig,
  statesById: Map<string, HaState>,
): AmpSwitchState | null {
  return desiredFromSource(statesById.get(config.sourceEntityId)?.state, config.offStates);
}
