import type { AmpPowerControlConfig } from "./config-schema";
import { readDashboardConfigSync } from "./dashboard-config";
import { callService, haRest } from "./ha";
import { readActiveFloatingCategoryId } from "./power";
import type { HaState } from "./types";

/**
 * The amp follows the Apple TV — while, and only while, the floating meter is
 * measuring the amp. See specs/amp-appletv-power.md.
 *
 * Adeline, 2026-09-19: "ensure that state changes NEVER occur more frequently
 * than once every 30 seconds, queue and space out any secondary changes […]
 * compact multiple state changes to get rid of any superfluous on/off/on
 * behaviour"; and "it should ONLY EVER power on or off the floating meter in
 * response to the apple tv if that category is selected."
 *
 * Both fall out of one property: this loop is LEVEL-TRIGGERED. It keeps no
 * queue of transitions, only ever asking "what should the plug be right now,
 * and is it that?". An on/off/on burst inside one window therefore issues
 * nothing at all, because by the time the window expires the desired state is
 * the actual state again (§4.5).
 *
 * Nothing here is ever surfaced: console logging only, the same silence
 * specs/power-meters.md §1 requires of the meter guard.
 */

export type AmpSwitchState = "on" | "off";

export type AmpAction =
  /** Nothing to do, or nothing we are entitled to do. */
  | { type: "none" }
  /** Put the plug down: force it on and hand it back to the meter guard. */
  | { type: "release" }
  /** Wants a change, but the rate limit has not expired. */
  | { type: "wait" }
  | { type: "command"; state: AmpSwitchState };

export type AmpDecisionInput = {
  /** The floating meter's active category is this controller's category. */
  armed: boolean;
  /** Are we currently holding the plug (and keeping the guard off it)? */
  owned: boolean;
  /** What the Apple TV says the amp should be. Null: it cannot be seen. */
  desired: AmpSwitchState | null;
  /** What the plug actually reads in HA. Null: it cannot be seen. */
  actual: AmpSwitchState | null;
  /** Since the last command we issued, or null if we have issued none. */
  msSinceLastCommand: number | null;
  /** How long `desired` has been null, or null if it is not. */
  msUnavailable: number | null;
  /** Already released because the source went stale; waiting for it to return. */
  staleHeld: boolean;
  minIntervalMs: number;
  staleRestoreMs: number;
};

/**
 * The whole decision, as a pure function so the rate limit and the coalescing
 * can be tested without a timer or a Home Assistant.
 */
export function decideAmpAction(input: AmpDecisionInput): AmpAction {
  // The gate. Any category but ours and this controller does not exist: no
  // command of any kind, and the plug goes back to the always-on guard (§4.2).
  if (!input.armed) {
    return input.owned ? { type: "release" } : { type: "none" };
  }

  if (input.desired === null) {
    // `unavailable` is not `off` — the same discipline the meter guard applies
    // to an off-network plug. But a dead integration must not be able to leave
    // the amp switched off forever, so after staleRestoreMs we put it down (§4.4).
    const stale = input.msUnavailable !== null && input.msUnavailable >= input.staleRestoreMs;
    return stale && input.owned && !input.staleHeld ? { type: "release" } : { type: "none" };
  }

  // Compared against what the switch ACTUALLY reads, not against what we last
  // commanded, so a dropped call is retried and a manual flip is corrected (§4.5).
  if (input.actual === null || input.actual === input.desired) {
    return { type: "none" };
  }
  if (input.msSinceLastCommand !== null && input.msSinceLastCommand < input.minIntervalMs) {
    return { type: "wait" };
  }
  return { type: "command", state: input.desired };
}

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

function ampConfig(): AmpPowerControlConfig | null {
  try {
    return readDashboardConfigSync().power.ampPowerControl ?? null;
  } catch {
    return null;
  }
}

/**
 * Entity ids the controller is currently holding. The meter guard skips these
 * (specs/amp-appletv-power.md §5) — empty whenever the controller is inert, so
 * §1 of specs/power-meters.md is untouched in every other arrangement.
 */
let owned: ReadonlySet<string> = new Set();
let lastCommandAt: number | null = null;
let unavailableSince: number | null = null;
let staleHeld = false;

export function ampControlledEntityIds(): ReadonlySet<string> {
  return owned;
}

async function commandSwitch(entityIds: readonly string[], state: AmpSwitchState) {
  for (const entityId of entityIds) {
    try {
      await callService("switch", state === "on" ? "turn_on" : "turn_off", { entity_id: entityId });
    } catch {
      // Swallowed. The next tick sees the plug still in the wrong state and
      // retries once the rate limit allows; a failed call still consumed a
      // switching opportunity, so it is not retried immediately (§4.6).
    }
  }
}

/** Force the plug on and stand down. Outside the rate limit on purpose (§4.3). */
async function release(entityIds: readonly string[], reason: string) {
  console.log(`[amp-power-control] releasing the plug (${reason}); restoring power`);
  owned = new Set();
  lastCommandAt = null;
  await commandSwitch(entityIds, "on");
}

async function tick() {
  const config = ampConfig();
  if (!config) {
    if (owned.size > 0) {
      await release([...owned], "no ampPowerControl config");
    }
    return;
  }

  const armed = (await readActiveFloatingCategoryId()) === config.categoryId;

  let states: HaState[] = [];
  if (armed) {
    try {
      states = await haRest<HaState[]>("/api/states");
    } catch {
      // Home Assistant is unreachable. Nothing to read, nobody to tell; the
      // next tick is seconds away. Ownership is kept: the guard cannot reach
      // HA either, so there is nothing for it to do in the meantime.
      return;
    }
  }
  const statesById = new Map(states.map((state) => [state.entity_id, state]));
  const desired = armed
    ? desiredFromSource(statesById.get(config.sourceEntityId)?.state, config.offStates)
    : null;

  const now = Date.now();
  if (armed && desired === null) {
    unavailableSince ??= now;
  } else {
    unavailableSince = null;
    if (desired !== null) staleHeld = false;
  }

  const action = decideAmpAction({
    actual: switchStateOf(config.switchEntityIds, statesById),
    armed,
    desired,
    minIntervalMs: config.minIntervalSeconds * 1000,
    msSinceLastCommand: lastCommandAt === null ? null : now - lastCommandAt,
    msUnavailable: unavailableSince === null ? null : now - unavailableSince,
    owned: owned.size > 0,
    staleHeld,
    staleRestoreMs: config.staleRestoreSeconds * 1000,
  });

  if (action.type === "release") {
    if (desired === null && armed) staleHeld = true;
    await release(config.switchEntityIds, armed ? "Apple TV unreadable" : "another category selected");
    return;
  }

  // Armed with a live source: we are managing the plug, so the guard stands off
  // it whether or not this tick changes anything.
  if (armed && desired !== null && owned.size === 0) {
    owned = new Set(config.switchEntityIds);
    console.log(`[amp-power-control] holding the plug; the amp now follows ${config.sourceEntityId}`);
  }

  if (action.type === "command") {
    console.log(`[amp-power-control] Apple TV is ${desired === "on" ? "on" : "off"}; switching the amp ${action.state}`);
    lastCommandAt = now;
    await commandSwitch(config.switchEntityIds, action.state);
  }
}

let started = false;

export function startAmpPowerControl() {
  if (started) {
    return;
  }
  const config = ampConfig();
  if (!config) {
    return;
  }
  started = true;
  void tick();
  const timer = setInterval(() => {
    void tick();
  }, config.pollIntervalSeconds * 1000);
  timer.unref?.();
}

export function resetAmpPowerControlForTest() {
  started = false;
  owned = new Set();
  lastCommandAt = null;
  unavailableSince = null;
  staleHeld = false;
}
