/**
 * Commanded-brightness bookkeeping for lights that fade toward a target.
 *
 * A light rarely lands on a commanded brightness the instant the service call
 * returns: bulbs ease in, cloud twins lag, and some fixtures settle a percent
 * or two off. This module records what brightness was last *asked for* per
 * entity so the command path can check back and re-drive anything that never
 * arrived, and so a newer command always wins over an older one's follow-up.
 *
 * It holds state and decisions only — no Home Assistant calls, no timers — so
 * it stays free of an import cycle with `lib/ha`, which owns both.
 */

/** Percent either side of the target that counts as "arrived". */
export const LIGHTING_CONVERGENCE_TOLERANCE_PCT = 2;

/**
 * Delays after the command at which the target is re-checked. Deliberately
 * short-then-longer: the first pass catches a fade that stalled, the second a
 * fixture that acknowledged and then drifted. After the last one the target is
 * dropped, so this can never become a standing override of a change made from
 * Home Assistant or a wall switch.
 */
export const LIGHTING_CONVERGENCE_RETRY_DELAYS_MS = [3000, 9000];

type LightingBrightnessTarget = {
  brightnessPct: number;
  token: number;
};

type LightingConvergenceStore = {
  targetsByEntityId: Map<string, LightingBrightnessTarget>;
  nextToken: number;
};

const globalWithLightingConvergence = globalThis as typeof globalThis & {
  __novaLightingConvergence?: LightingConvergenceStore;
};

const store =
  globalWithLightingConvergence.__novaLightingConvergence ??
  (globalWithLightingConvergence.__novaLightingConvergence = {
    targetsByEntityId: new Map<string, LightingBrightnessTarget>(),
    nextToken: 0,
  });

/**
 * Record the brightness just commanded for each entity and return the token
 * that identifies this command. Recording replaces any older target for the
 * same entity, which is how a newer drag supersedes an in-flight follow-up.
 */
export function claimLightingBrightnessTargets(
  targets: Array<{ entityId: string; brightnessPct: number }>,
): number {
  const token = store.nextToken + 1;
  store.nextToken = token;

  for (const target of targets) {
    const entityId = target.entityId.trim();
    if (!entityId) {
      continue;
    }
    store.targetsByEntityId.set(entityId, { brightnessPct: target.brightnessPct, token });
  }

  return token;
}

/** Entities this command still owns a target for. */
export function lightingBrightnessTargetEntityIds(token: number): string[] {
  return Array.from(store.targetsByEntityId.entries())
    .filter(([, target]) => target.token === token)
    .map(([entityId]) => entityId);
}

/**
 * The brightness this command asked of the entity, or `null` once a newer
 * command has taken the entity over (or the target has been dropped).
 */
export function lightingBrightnessTargetFor(entityId: string, token: number): number | null {
  const target = store.targetsByEntityId.get(entityId);
  return target && target.token === token ? target.brightnessPct : null;
}

/** Stop tracking the entity, but only if this command is still its owner. */
export function releaseLightingBrightnessTarget(entityId: string, token: number) {
  const target = store.targetsByEntityId.get(entityId);
  if (target && target.token === token) {
    store.targetsByEntityId.delete(entityId);
  }
}

export function releaseLightingBrightnessTargets(token: number) {
  for (const entityId of lightingBrightnessTargetEntityIds(token)) {
    store.targetsByEntityId.delete(entityId);
  }
}

/**
 * Every entity with a commanded brightness still outstanding, as
 * `entityId -> targetPct`.
 *
 * This is the definition of "transitional": a target is recorded when the
 * command is sent and dropped as soon as the light is observed to have arrived
 * (or the follow-up schedule ends), so an entry here means the light is still
 * moving and its reported brightness is not a result yet. The state projection
 * publishes these as `brightnessTransition` so every client — not just the one
 * that issued the command — knows a final value is still coming and can show the
 * target instead of the fade.
 */
export function lightingBrightnessTargetSnapshot(): Record<string, number> {
  const snapshot: Record<string, number> = {};
  for (const [entityId, target] of store.targetsByEntityId) {
    snapshot[entityId] = target.brightnessPct;
  }
  return snapshot;
}

/** Home Assistant reports brightness as `0..255`; the dashboard commands percent. */
export function brightnessPctFromAttribute(raw: number | null): number | null {
  if (raw === null || !Number.isFinite(raw)) {
    return null;
  }
  return Math.round((raw / 255) * 100);
}

/**
 * True when the light is far enough from the commanded brightness to be worth
 * re-driving. An unknown current brightness counts as not-arrived: a light that
 * is on and reporting nothing useful is exactly the case worth re-sending.
 */
export function needsBrightnessConvergence(currentPct: number | null, targetPct: number): boolean {
  if (currentPct === null) {
    return true;
  }
  return Math.abs(currentPct - targetPct) > LIGHTING_CONVERGENCE_TOLERANCE_PCT;
}

export function resetLightingConvergenceForTest() {
  store.targetsByEntityId.clear();
  store.nextToken = 0;
}
