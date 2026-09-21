import type { AmpPowerControlConfig } from "./config-schema";
import type { HaState } from "./types";

/**
 * The amp controller's inputs, as plain values: what the Apple TV asks for
 * (its power state, and which speakers it is playing through) and what the
 * plug actually reads.
 *
 * Split out of `lib/amp-power-control.ts` so that loop stays small — it does
 * IO and nothing else, and everything here is testable without a timer or a
 * Home Assistant. See specs/amp-appletv-power.md §1.1 and §8.
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

/** What the audio output asks for. Null: no opinion (§8.3). */
export type AmpAudioSignal = AmpSwitchState | null;

export type AmpAudioConfig = {
  offStates: readonly string[];
  onStates: readonly string[];
};

/**
 * The audio-output condition (§8.2): the amp is worth powering while the Apple
 * TV is playing through the TV's own speakers, and pointless while it plays
 * anywhere else — Bluetooth headphones, a HomePod, an AirPlay receiver.
 *
 * A value this household has not classified — `unavailable`, `unknown`, a
 * missing entity, a name the bridge has not reported before — is **no opinion**,
 * never "off". A dead bridge must not be able to silence the amplifier, which
 * is the same safe direction to be wrong in that §1.1 chose for the off-states.
 */
export function desiredFromAudioOutput(
  state: string | undefined,
  config: AmpAudioConfig,
): AmpAudioSignal {
  if (!state) {
    return null;
  }
  if (config.onStates.includes(state)) {
    return "on";
  }
  if (config.offStates.includes(state)) {
    return "off";
  }
  return null;
}

/**
 * The two conditions as one. A sleeping Apple TV decides it alone — whatever
 * its audio route was, an off Apple TV is drawing nothing through the amp —
 * and while it is awake the route overrules the power state, so the amp
 * follows the speakers she is actually listening to. An unreadable route
 * leaves the amp on, which is exactly what this house had before §8 existed.
 */
export function combinedAmpDesired(
  power: AmpSwitchState | null,
  audio: AmpAudioSignal,
): AmpSwitchState | null {
  if (power !== "on") {
    return power;
  }
  return audio ?? "on";
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
  const audio = config.audioOutput
    ? desiredFromAudioOutput(statesById.get(config.audioOutput.entityId)?.state, config.audioOutput)
    : null;
  return combinedAmpDesired(
    desiredFromSource(statesById.get(config.sourceEntityId)?.state, config.offStates),
    audio,
  );
}
