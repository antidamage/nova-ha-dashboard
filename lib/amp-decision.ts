import type { AmpSwitchState } from "./amp-inputs";

/**
 * What the controller should do this tick — the whole decision as a pure
 * function, so the gates, the rate limit and the coalescing can be tested
 * without a timer or a Home Assistant.
 *
 * Split out of `lib/amp-power-control.ts`, which keeps the IO: see
 * specs/amp-appletv-power.md §4.
 */

export type AmpAction =
  /** Nothing to do, or nothing we are entitled to do. */
  | { type: "none" }
  /** Put the plug down: force it on and hand it back to the meter guard. */
  | { type: "release" }
  /** Wants a change, but the rate limit has not expired. */
  | { type: "wait" }
  | { type: "command"; state: AmpSwitchState };

export type AmpDecisionInput = {
  /**
   * Allowed to act: the meter is on this controller's category (§4.2) **and**
   * at least one of the panel's two switches (§7) is on.
   */
  armed: boolean;
  /** May this automation switch the amp **off**? (§7) */
  autoOff: boolean;
  /** May it switch the amp **on**? (§7) */
  autoOn: boolean;
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

  // The panel's two switches, one per direction (§7). A direction that is
  // switched off is not commanded at all — not even to undo a manual flip, so
  // the amp stays wherever the household last put it.
  if (input.desired === "on" ? !input.autoOn : !input.autoOff) {
    return { type: "none" };
  }

  if (input.msSinceLastCommand !== null && input.msSinceLastCommand < input.minIntervalMs) {
    return { type: "wait" };
  }
  return { type: "command", state: input.desired };
}
