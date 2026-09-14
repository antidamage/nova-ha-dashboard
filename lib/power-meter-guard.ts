import { readDashboardConfigSync } from "./dashboard-config";
import { callService, haRest } from "./ha";
import type { AlwaysOnMeter } from "./config-schema";
import type { HaState } from "./types";

/**
 * Meters that must never be left switched off.
 *
 * Adeline's rule, 2026-09-14: "neither of them must ever be switched off. If
 * they are, power is to be restored immediately. this should be a polling check
 * every minute. don't send me errors if they're down, just try to restore their
 * power state."
 *
 * This is a STANDING OVERRIDE, which is exactly what lib/lighting-convergence.ts
 * deliberately refuses to be. That restraint is right for lights — a person at a
 * wall switch must win — and wrong here: a meter that stops measuring stops
 * being a meter. The two positions stay compatible only because this loop can
 * never touch anything but the entities named in `power.alwaysOnMeters`. Do not
 * generalise it.
 *
 * Nothing here is ever surfaced. No toast, no dashboard warning, no Discord, no
 * error field in any payload — console logging only, so the behaviour is
 * auditable in container logs and nowhere else.
 *
 * See specs/power-meters.md §1.
 */

export const POWER_METER_GUARD_POLL_MS = 60_000;

export type MeterGuardAction = { entityId: string; meterId: string };

function readMeters(): AlwaysOnMeter[] {
  try {
    return readDashboardConfigSync().power.alwaysOnMeters ?? [];
  } catch {
    return [];
  }
}

/**
 * The whole decision, as a pure function so it can be tested without a timer.
 *
 * `off` is restored. `unavailable`, `unknown` and a missing entity are NOT
 * `off` — the plug is off-network, a service call cannot reach it, and firing
 * one would only produce log noise once a minute forever. `on` is left alone.
 *
 * Every known entity id for a meter is considered, because a Tuya device that
 * is re-paired or moves between the LAN and cloud twin answers on a different
 * id (see lib/ha/twins.ts). Whichever ids are present and `off` get restored.
 */
export function meterRestoreActions(
  meters: AlwaysOnMeter[],
  statesById: Map<string, HaState>,
): MeterGuardAction[] {
  const actions: MeterGuardAction[] = [];
  for (const meter of meters) {
    for (const entityId of meter.switchEntityIds) {
      const state = statesById.get(entityId);
      if (state?.state === "off") {
        actions.push({ entityId, meterId: meter.id });
      }
    }
  }
  return actions;
}

/** Entity ids seen `off` on the previous tick, so a restore logs once. */
const loggedOff = new Set<string>();

async function guardTick() {
  const meters = readMeters();
  if (meters.length === 0) {
    return;
  }

  let states: HaState[];
  try {
    states = await haRest<HaState[]>("/api/states");
  } catch {
    // Home Assistant is unreachable. There is nothing to restore and nobody to
    // tell; the next tick is 60 seconds away.
    return;
  }

  const statesById = new Map(states.map((state) => [state.entity_id, state]));
  const actions = meterRestoreActions(meters, statesById);
  const offNow = new Set(actions.map((action) => action.entityId));
  for (const entityId of loggedOff) {
    if (!offNow.has(entityId)) {
      loggedOff.delete(entityId);
    }
  }

  for (const action of actions) {
    if (!loggedOff.has(action.entityId)) {
      console.log(`[power-meter-guard] ${action.entityId} was off; restoring`);
      loggedOff.add(action.entityId);
    }
    try {
      await callService("switch", "turn_on", { entity_id: action.entityId });
    } catch {
      // Swallowed on purpose. The next tick retries.
    }
  }
}

let started = false;

export function startPowerMeterGuard() {
  if (started) {
    return;
  }
  started = true;
  void guardTick();
  const timer = setInterval(() => {
    void guardTick();
  }, POWER_METER_GUARD_POLL_MS);
  timer.unref?.();
}

export function resetPowerMeterGuardForTest() {
  started = false;
  loggedOff.clear();
}
