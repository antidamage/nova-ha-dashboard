/**
 * Doorbell coordinator: the stateful half of the decision.
 *
 * Takes a sequence from the device, asks the pure rules in doorbell.ts what it
 * means, and then does exactly one of: nothing, raise a visitor alert, or ask
 * the lock to open once. It owns replay protection, the failed-attempt
 * lockout, and the audit trail.
 *
 * The unlock path is deliberately narrow. There is no client-facing endpoint
 * that opens the door on request — the only way through is an authenticated
 * device event that satisfies every rule.
 */

import { randomUUID } from "node:crypto";
import { callService } from "./ha/client";
import { appendHouseholdEvent } from "./household-events";
import { publishDoorbellAlert } from "./dashboard-events";
import { readDoorbellSecrets } from "./doorbell-secrets";
import {
  buildAlert,
  decideDoorbell,
  type DoorbellAlert,
  type DoorbellConfig,
  type DoorbellDecision,
  type DoorbellSequence,
} from "./doorbell";

/** How many event ids to remember for replay protection. */
const SEEN_EVENT_LIMIT = 512;
const DEFAULT_VISUAL_TIMEOUT_MS = 12_000;
const UNLOCK_TIMEOUT_MS = 8_000;

type CoordinatorState = {
  seenEventIds: Set<string>;
  lastAlertAtMs: number | null;
  failedAttempts: number;
  lockedOutUntilMs: number | null;
  successfulUses: Map<string, number>;
};

const state: CoordinatorState = {
  seenEventIds: new Set(),
  lastAlertAtMs: null,
  failedAttempts: 0,
  lockedOutUntilMs: null,
  successfulUses: new Map(),
};

export function resetDoorbellCoordinatorForTest() {
  state.seenEventIds.clear();
  state.lastAlertAtMs = null;
  state.failedAttempts = 0;
  state.lockedOutUntilMs = null;
  state.successfulUses.clear();
}

function rememberEventId(eventId: string) {
  state.seenEventIds.add(eventId);
  if (state.seenEventIds.size > SEEN_EVENT_LIMIT) {
    // Sets iterate in insertion order, so this drops the oldest.
    const oldest = state.seenEventIds.values().next();
    if (!oldest.done) {
      state.seenEventIds.delete(oldest.value);
    }
  }
}

async function audit(
  sequence: DoorbellSequence,
  decision: DoorbellDecision,
  extra: Record<string, unknown> = {},
) {
  try {
    await appendHouseholdEvent({
      occurredAt: new Date().toISOString(),
      source: "dashboard",
      kind: "occupancy",
      deduplicationKey: `doorbell/${sequence.deviceId}/${sequence.eventId}`,
      payload: {
        doorbell: true,
        deviceId: sequence.deviceId,
        eventId: sequence.eventId,
        verdict: decision.verdict,
        // The reason is safe to log: it says which rule failed, never by how
        // much, and never any part of a stored rhythm.
        reason: decision.reason,
        knockCount: sequence.knocks.length,
        presence: sequence.presence,
        ...extra,
      },
    });
  } catch (error) {
    console.error("[nova-dashboard] doorbell audit append failed", {
      message: (error as Error)?.message,
    });
  }
}

/**
 * Ask Home Assistant to unlock, once.
 *
 * Returns whether the command was accepted. An ambiguous or timed-out unlock
 * is never retried automatically — a door that might already be open is a
 * situation for a person, not a retry loop.
 */
async function unlockOnce(lockEntityId: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UNLOCK_TIMEOUT_MS);
  try {
    await callService("lock", "unlock", { entity_id: lockEntityId }, { signal: controller.signal });
    return true;
  } catch (error) {
    console.error("[nova-dashboard] doorbell unlock failed", {
      entityId: lockEntityId,
      message: (error as Error)?.message,
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export type IngestResult = {
  verdict: DoorbellDecision["verdict"];
  alerted: boolean;
  unlocked: boolean;
};

export async function ingestDoorbellSequence(
  sequence: DoorbellSequence,
  config: DoorbellConfig,
  options: { now?: Date; visualTimeoutMs?: number } = {},
): Promise<IngestResult> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();

  if (state.lockedOutUntilMs !== null && nowMs >= state.lockedOutUntilMs) {
    state.lockedOutUntilMs = null;
    state.failedAttempts = 0;
  }
  const lockedOut = state.lockedOutUntilMs !== null;

  // Merge in the use counts the coordinator has been tracking this run, so a
  // single-use secret cannot be replayed by restarting the config read.
  const configWithUses: DoorbellConfig = {
    ...config,
    secrets: config.secrets.map((secret) => ({
      ...secret,
      successfulUses: state.successfulUses.get(secret.id) ?? secret.successfulUses,
    })),
  };

  const templates = configWithUses.access.enabled ? await readDoorbellSecrets() : [];

  const decision = decideDoorbell({
    sequence,
    config: configWithUses,
    templates,
    now,
    lastAlertAtMs: state.lastAlertAtMs,
    duplicate: state.seenEventIds.has(sequence.eventId),
    lockedOut,
  });

  rememberEventId(sequence.eventId);

  if (!decision.alerts) {
    await audit(sequence, decision);
    return { verdict: decision.verdict, alerted: false, unlocked: false };
  }

  let unlocked = false;
  let alert: DoorbellAlert;

  if (decision.verdict === "authorized" && configWithUses.access.lockEntityId) {
    unlocked = await unlockOnce(configWithUses.access.lockEntityId);
    if (unlocked) {
      state.failedAttempts = 0;
      if (decision.secretId) {
        state.successfulUses.set(
          decision.secretId,
          (state.successfulUses.get(decision.secretId) ?? 0) + 1,
        );
      }
      alert = buildAlert(sequence, decision, now, options.visualTimeoutMs ?? DEFAULT_VISUAL_TIMEOUT_MS);
    } else {
      // The authorized sound must never play for a door that did not open, so
      // a failed command becomes its own alert kind rather than a success.
      alert = {
        ...buildAlert(sequence, decision, now, options.visualTimeoutMs ?? DEFAULT_VISUAL_TIMEOUT_MS),
        kind: "failed",
        title: "The door would not unlock",
      };
    }
  } else {
    if (configWithUses.access.enabled && configWithUses.access.mode === "unlock") {
      // A visitor alert while access is armed means a candidate did not match.
      // Count it, so guessing at the rhythm eventually stops being free.
      state.failedAttempts += 1;
      if (state.failedAttempts >= configWithUses.access.failedAttemptLimit) {
        state.lockedOutUntilMs = nowMs + configWithUses.access.lockoutMs;
        console.warn("[nova-dashboard] doorbell locked out after failed attempts", {
          attempts: state.failedAttempts,
          untilMs: state.lockedOutUntilMs,
        });
      }
    }
    alert = buildAlert(sequence, decision, now, options.visualTimeoutMs ?? DEFAULT_VISUAL_TIMEOUT_MS);
  }

  // A fresh uuid per alert so a client that reconnects mid-alert can dedupe on
  // dedupeKey without two different alerts ever colliding on id.
  alert.id = randomUUID();
  state.lastAlertAtMs = nowMs;

  publishDoorbellAlert(alert);
  await audit(sequence, decision, { alertKind: alert.kind, unlocked });

  return { verdict: decision.verdict, alerted: true, unlocked };
}
