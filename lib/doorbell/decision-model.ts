import { bestSecretMatch } from "./knock-model";
import { isWithinSchedule } from "./schedule-model";
import type { DoorbellAlert, DoorbellDecision, DoorbellSequence, FusionInput } from "./types";

/**
 * The whole decision, in one place.
 *
 * Ordering matters: cheap structural rejections first, then presence, then the
 * cooldown, and only then anything that could open a door. Every path that
 * cannot prove access is allowed falls through to an ordinary visitor alert —
 * a failed secret must look exactly like somebody knocking, so a watcher
 * cannot tell whether they were close.
 */
export function decideDoorbell(input: FusionInput): DoorbellDecision {
  const { sequence, config, templates, now, lastAlertAtMs, duplicate, lockedOut } = input;

  if (!config.enabled) {
    return { verdict: "ignored_disabled", reason: "doorbell disabled in config", alerts: false };
  }
  if (duplicate) {
    return { verdict: "ignored_duplicate", reason: "event id already processed", alerts: false };
  }
  if (sequence.knocks.length < config.fusion.minimumKnocks) {
    return {
      verdict: "ignored_too_few_knocks",
      reason: `${sequence.knocks.length} knocks, need ${config.fusion.minimumKnocks}`,
      alerts: false,
    };
  }

  // Presence without knocks never reaches here, and knocks without presence
  // stop here. Both halves of the stated requirement live on this line.
  const presenceOk = sequence.presence
    || sequence.presenceAgeMs <= config.fusion.presenceTrailMs;
  if (config.access.requirePresence && !presenceOk) {
    return {
      verdict: "ignored_no_presence",
      reason: `no presence within ${config.fusion.presenceTrailMs}ms`,
      alerts: false,
    };
  }

  if (
    lastAlertAtMs !== null
    && now.getTime() - lastAlertAtMs < config.fusion.notificationCooldownMs
  ) {
    return { verdict: "ignored_cooldown", reason: "inside notification cooldown", alerts: false };
  }

  const visitor: DoorbellDecision = {
    verdict: "visitor",
    reason: "valid knock sequence with presence",
    alerts: true,
  };

  if (!config.access.enabled || config.access.mode !== "unlock") {
    return visitor;
  }
  if (lockedOut) {
    // Deliberately indistinguishable from an ordinary visitor to anyone at the
    // door; the audit log records the difference.
    return { ...visitor, reason: "locked out after failed attempts" };
  }
  if (!config.access.lockEntityId) {
    return { ...visitor, reason: "no lock entity configured" };
  }

  const { match, ambiguous } = bestSecretMatch(
    sequence.knocks,
    templates,
    config.access.ambiguityMargin,
  );
  if (ambiguous) {
    return { ...visitor, reason: "secret match ambiguous" };
  }
  if (!match) {
    return visitor;
  }

  const meta = config.secrets.find((s) => s.id === match.id);
  if (!meta || !meta.configured) {
    return { ...visitor, reason: "matched secret is not configured" };
  }
  if (meta.maxSuccessfulUses !== null && meta.successfulUses >= meta.maxSuccessfulUses) {
    return { ...visitor, reason: "secret has no uses left" };
  }

  const schedules = config.schedules.filter((s) => meta.scheduleIds.includes(s.id));
  if (!isWithinSchedule(now, config.access.timezone, schedules)) {
    return { ...visitor, reason: "outside the allowed schedule" };
  }

  return {
    verdict: "authorized",
    reason: "secret matched inside an allowed window",
    secretId: match.id,
    alerts: true,
  };
}

export function buildAlert(
  sequence: DoorbellSequence,
  decision: DoorbellDecision,
  now: Date,
  visualTimeoutMs: number,
): DoorbellAlert {
  const kind: DoorbellAlert["kind"] = decision.verdict === "authorized" ? "authorized" : "visitor";
  return {
    schema: 1,
    id: `${sequence.deviceId}/${sequence.eventId}`,
    dedupeKey: `${sequence.deviceId}/${sequence.eventId}`,
    kind,
    title: kind === "authorized" ? "The door has been unlocked" : "Someone is at the door",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + visualTimeoutMs).toISOString(),
    sourceDeviceId: sequence.deviceId,
    knockCount: sequence.knocks.length,
  };
}
