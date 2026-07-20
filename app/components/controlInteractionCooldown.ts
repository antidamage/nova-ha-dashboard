/**
 * One cooldown contract for every interactive dashboard/config control.
 *
 * Server polling and pushed snapshots must not reconcile UI state while a
 * control is being manipulated, nor for six seconds after its release. This
 * gives writes time to round-trip without stale state snapping an optimistic
 * control back to its old value.
 */
export const CONTROL_INTERACTION_COOLDOWN_MS = 6000;

let activeInteractions = 0;
let pausedUntil = 0;

export function beginControlInteraction() {
  activeInteractions += 1;
}

export function endControlInteraction() {
  activeInteractions = Math.max(0, activeInteractions - 1);
  pausedUntil = Math.max(pausedUntil, Date.now() + CONTROL_INTERACTION_COOLDOWN_MS);
}

/** Use for discrete controls such as buttons, toggles and keyboard slider steps. */
export function markControlInteraction(cooldownMs: number = CONTROL_INTERACTION_COOLDOWN_MS) {
  pausedUntil = Math.max(
    pausedUntil,
    Date.now() + Math.max(CONTROL_INTERACTION_COOLDOWN_MS, cooldownMs),
  );
}

export function isControlInteractionCoolingDown() {
  return activeInteractions > 0 || Date.now() < pausedUntil;
}

/** Test-only reset; production callers should only extend the deadline. */
export function resetControlInteractionCooldownForTests() {
  activeInteractions = 0;
  pausedUntil = 0;
}
