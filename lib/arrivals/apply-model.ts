import type { ArrivalState } from "../config-schema/arrivals";
import type { ArrivalTarget } from "./types";

export type ArrivalStateResult = {
  target: ArrivalState["target"];
  presetId: string;
  ok: boolean;
  error?: string;
};

/**
 * Apply every configured state, in order, and keep going when one fails: an
 * arrival that puts the lights on must not skip the air conditioning because a
 * preset it names no longer exists. Each entry reports its own outcome, and the
 * caller decides what a partial failure means.
 */
export async function applyArrivalStates(
  states: readonly ArrivalState[],
  targets: Record<string, ArrivalTarget>,
): Promise<ArrivalStateResult[]> {
  const results: ArrivalStateResult[] = [];
  for (const state of states) {
    const target = targets[state.target];
    if (!target) {
      results.push({
        target: state.target,
        presetId: state.presetId,
        ok: false,
        error: `No target is installed for "${state.target}"`,
      });
      continue;
    }
    try {
      await target.apply(state.presetId);
      results.push({ target: state.target, presetId: state.presetId, ok: true });
    } catch (error) {
      results.push({
        target: state.target,
        presetId: state.presetId,
        ok: false,
        error: error instanceof Error ? error.message : `Applying "${state.presetId}" failed`,
      });
    }
  }
  return results;
}
