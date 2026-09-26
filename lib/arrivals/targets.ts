import { ARRIVAL_TARGET_KINDS, type ArrivalTargetKind } from "../config-schema/arrivals";
import { climateArrivalTarget } from "./targets/climate";
import { lightingArrivalTarget } from "./targets/lighting";
import { volumeArrivalTarget } from "./targets/volume";
import type { ArrivalTarget } from "./types";

/**
 * Every kind of device state an arrival or a departure may set.
 *
 * The keys are the schema's ARRIVAL_TARGET_KINDS: `Record<ArrivalTargetKind, …>`
 * makes a missing one a type error, and lib/arrivals/targets.test.ts pins the
 * two together at runtime so the config page can never offer a kind with no
 * target behind it.
 */
export const ARRIVAL_TARGETS: Record<ArrivalTargetKind, ArrivalTarget> = {
  lighting: lightingArrivalTarget,
  climate: climateArrivalTarget,
  volume: volumeArrivalTarget,
};

/** Every target, in the schema's order, for a picker or a payload. */
export function arrivalTargets(): ArrivalTarget[] {
  return ARRIVAL_TARGET_KINDS.map((kind) => ARRIVAL_TARGETS[kind]);
}
