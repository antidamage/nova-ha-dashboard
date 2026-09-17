// Pure: busy-phase and sha decisions over the updater's state.
import { BUSY_PHASES, BUSY_PHASE_STALE_MS } from "./constants";
import type { UpdaterState } from "./types";

export function isUpdaterBusyState(state: UpdaterState | null): boolean {
  if (!state?.phase || !BUSY_PHASES.has(state.phase)) {
    return false;
  }
  const phaseAt = Date.parse(state.phaseAt ?? "");
  if (Number.isFinite(phaseAt) && Date.now() - phaseAt > BUSY_PHASE_STALE_MS) {
    return false;
  }
  return true;
}

export function shortSha(sha: string | null | undefined): string | null {
  return sha ? sha.slice(0, 7) : null;
}

/**
 * Best-effort discovery of the sha this build was cut from, for environments
 * where the host updater has not written state.json yet (local dev, or a
 * pre-migration flat install).
 */
export function fallbackSha(): string | null {
  const fromEnv = process.env.NOVA_DASHBOARD_SHA?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

/**
 * Treat a blank sha as absent.
 *
 * The updater writes `"currentSha": ""` into state.json before it has ever
 * deployed anything, and an empty string is NOT nullish -- so `??` accepted it
 * as a real value, the fallback below was never consulted, and
 * `updateAvailable` (which requires a truthy currentSha) was pinned to false
 * forever. The dashboard therefore reported "Already up to date ()" -- note the
 * empty parens -- while sitting on an unknown version, and no update could ever
 * be offered or applied.
 */
export function definedSha(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
