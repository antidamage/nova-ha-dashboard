/**
 * Doorbell decision logic.
 *
 * Everything in this file is pure: given a sequence and a configuration it
 * returns a decision. The stateful parts — dedupe, lockout counters, alert
 * fan-out, the lock call — live in doorbell-coordinator.ts, so the rules that
 * decide whether a door opens can be tested exhaustively without a server.
 *
 * The device deliberately has no say in this. It reports timings; Nova decides.
 * See smart-doorbell/PROJECT-PLAN.md §6.
 */

export const DOORBELL_SEQUENCE_SCHEMA_VERSION = 1;

/** One impact, as reported by the device. Timings only — never audio. */
export type DoorbellKnock = {
  /** Milliseconds since the first knock of this sequence. */
  atMs: number;
  /** Envelope peak, 0..1. */
  peak: number;
};

/** The payload posted by the ESP32 for each accepted sequence. */
export type DoorbellSequence = {
  schema: number;
  eventId: string;
  deviceId: string;
  uptimeMs: number;
  presence: boolean;
  presenceAgeMs: number;
  knocks: DoorbellKnock[];
  noiseFloor: number;
  configVersion: number;
};

export type DoorbellFusionConfig = {
  minimumKnocks: number;
  presenceLeadMs: number;
  presenceTrailMs: number;
  notificationCooldownMs: number;
};

export type DoorbellScheduleWindow = {
  /** 0 = Sunday, matching Date#getDay. */
  daysOfWeek: number[];
  /** "HH:MM" local to the configured time zone. */
  start: string;
  end: string;
};

export type DoorbellSchedule = {
  id: string;
  windows: DoorbellScheduleWindow[];
  /** ISO dates ("YYYY-MM-DD") on which this schedule never grants access. */
  denyDates: string[];
};

export type DoorbellSecretMeta = {
  id: string;
  label: string;
  configured: boolean;
  scheduleIds: string[];
  maxSuccessfulUses: number | null;
  successfulUses: number;
};

/**
 * The sensitive half of a secret knock. Stored encrypted at rest and never
 * returned through any client-facing payload — the shared config is served to
 * browsers, so an unredacted template here is a disclosed door key.
 */
export type DoorbellSecretTemplate = {
  id: string;
  /** Median gap between consecutive knocks, in milliseconds. */
  intervals: number[];
  /** Per-interval tolerance as a fraction, e.g. 0.25 for ±25%. */
  tolerance: number;
  /** Allowed overall pace scaling, e.g. [0.65, 1.5]. */
  paceRange: [number, number];
  sampleCount: number;
};

export type DoorbellAccessConfig = {
  enabled: boolean;
  mode: "notify_only" | "unlock";
  timezone: string;
  requirePresence: boolean;
  failedAttemptLimit: number;
  lockoutMs: number;
  /** Best match must beat the runner-up by this ratio to count as unambiguous. */
  ambiguityMargin: number;
  lockEntityId: string | null;
};

export type DoorbellConfig = {
  enabled: boolean;
  deviceId: string;
  fusion: DoorbellFusionConfig;
  access: DoorbellAccessConfig;
  schedules: DoorbellSchedule[];
  secrets: DoorbellSecretMeta[];
};

export type DoorbellVerdict =
  | "visitor"
  | "authorized"
  | "denied"
  | "ignored_too_few_knocks"
  | "ignored_no_presence"
  | "ignored_cooldown"
  | "ignored_duplicate"
  | "ignored_disabled";

export type DoorbellDecision = {
  verdict: DoorbellVerdict;
  /** Human-readable reason, for the audit log. Never contains secret timings. */
  reason: string;
  /** Set only when verdict is "authorized". */
  secretId?: string;
  /** True when the decision should produce a client-visible alert. */
  alerts: boolean;
};

/** Result of matching a sequence against one stored template. */
export type SecretMatch = {
  id: string;
  /** 0..1, higher is better. 0 means structurally impossible. */
  score: number;
};

export function isDoorbellSequence(value: unknown): value is DoorbellSequence {
  if (!value || typeof value !== "object") {
    return false;
  }
  const seq = value as Partial<DoorbellSequence>;
  return (
    seq.schema === DOORBELL_SEQUENCE_SCHEMA_VERSION
    && typeof seq.eventId === "string"
    && seq.eventId.length > 0
    && seq.eventId.length <= 128
    && typeof seq.deviceId === "string"
    && seq.deviceId.length > 0
    && typeof seq.presence === "boolean"
    && Number.isFinite(seq.presenceAgeMs)
    && Number.isFinite(seq.noiseFloor)
    && Number.isFinite(seq.configVersion)
    && Array.isArray(seq.knocks)
    // A device that reports hundreds of knocks is faulty or hostile; either
    // way the payload is bounded before any of it is trusted.
    && seq.knocks.length > 0
    && seq.knocks.length <= 32
    && seq.knocks.every(
      (k) => k && Number.isFinite(k.atMs) && Number.isFinite(k.peak) && k.atMs >= 0,
    )
  );
}

/** Gaps between consecutive knocks. A sequence of n knocks has n-1 intervals. */
export function intervalsOf(knocks: DoorbellKnock[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < knocks.length; i += 1) {
    out.push(knocks[i].atMs - knocks[i - 1].atMs);
  }
  return out;
}

/**
 * Score a sequence against a stored template.
 *
 * Matching is on interval *ratios* plus an overall pace check, not absolute
 * timestamps: the same rhythm knocked a little faster or slower is still the
 * same rhythm, but a different rhythm at any speed is not. A mismatched knock
 * count is rejected outright rather than penalised, because a template with
 * one extra tap is a different credential.
 */
export function scoreSecret(
  knocks: DoorbellKnock[],
  template: DoorbellSecretTemplate,
): SecretMatch {
  const observed = intervalsOf(knocks);
  if (observed.length === 0 || observed.length !== template.intervals.length) {
    return { id: template.id, score: 0 };
  }

  const templateTotal = template.intervals.reduce((a, b) => a + b, 0);
  const observedTotal = observed.reduce((a, b) => a + b, 0);
  if (templateTotal <= 0 || observedTotal <= 0) {
    return { id: template.id, score: 0 };
  }

  const pace = observedTotal / templateTotal;
  const [paceMin, paceMax] = template.paceRange;
  if (pace < paceMin || pace > paceMax) {
    return { id: template.id, score: 0 };
  }

  // Compare each interval after normalising out the overall pace, so a
  // uniformly faster performance is not penalised twice.
  let worst = 1;
  for (let i = 0; i < observed.length; i += 1) {
    const expected = template.intervals[i] * pace;
    if (expected <= 0) {
      return { id: template.id, score: 0 };
    }
    const error = Math.abs(observed[i] - expected) / expected;
    if (error > template.tolerance) {
      return { id: template.id, score: 0 };
    }
    worst = Math.min(worst, 1 - error / template.tolerance);
  }

  return { id: template.id, score: worst };
}

/**
 * Pick the best match, but only if it is clearly better than the runner-up.
 *
 * Two similar rhythms that both fit means the household cannot know which
 * credential was used, so the safe answer is "no match at all".
 */
export function bestSecretMatch(
  knocks: DoorbellKnock[],
  templates: DoorbellSecretTemplate[],
  ambiguityMargin: number,
): { match: SecretMatch | null; ambiguous: boolean } {
  const scored = templates
    .map((t) => scoreSecret(knocks, t))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { match: null, ambiguous: false };
  }
  if (scored.length === 1) {
    return { match: scored[0], ambiguous: false };
  }
  if (scored[0].score - scored[1].score < ambiguityMargin) {
    return { match: null, ambiguous: true };
  }
  return { match: scored[0], ambiguous: false };
}

function minutesOfDay(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) {
    return null;
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

/**
 * Local wall-clock parts for an instant in a named IANA zone.
 *
 * Uses Intl rather than manual offset arithmetic so DST transitions are
 * handled by the platform's tz database — Pacific/Auckland shifts twice a year
 * and a hand-rolled offset would silently grant or deny an hour of access.
 */
export function localPartsInZone(at: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-NZ", {
    timeZone: timezone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: weekdays.indexOf(String(parts.weekday).slice(0, 3)),
    minutes: hour * 60 + Number(parts.minute),
  };
}

/** Is `at` inside any window of the given schedules, in the configured zone? */
export function isWithinSchedule(
  at: Date,
  timezone: string,
  schedules: DoorbellSchedule[],
): boolean {
  if (schedules.length === 0) {
    return false;
  }
  let local;
  try {
    local = localPartsInZone(at, timezone);
  } catch {
    // An unusable time zone means we cannot know whether access is allowed,
    // and "cannot know" must resolve to "no".
    return false;
  }
  if (local.dayOfWeek < 0) {
    return false;
  }

  for (const schedule of schedules) {
    if (schedule.denyDates.includes(local.isoDate)) {
      continue;
    }
    for (const window of schedule.windows) {
      const start = minutesOfDay(window.start);
      const end = minutesOfDay(window.end);
      if (start === null || end === null) {
        continue;
      }
      if (start <= end) {
        if (
          schedule.windows.length > 0
          && window.daysOfWeek.includes(local.dayOfWeek)
          && local.minutes >= start
          && local.minutes < end
        ) {
          return true;
        }
      } else {
        // Crosses midnight: the window belongs to the day it started on, so
        // the small hours match the *previous* day's entry.
        const previousDay = (local.dayOfWeek + 6) % 7;
        if (window.daysOfWeek.includes(local.dayOfWeek) && local.minutes >= start) {
          return true;
        }
        if (window.daysOfWeek.includes(previousDay) && local.minutes < end) {
          return true;
        }
      }
    }
  }
  return false;
}

export type FusionInput = {
  sequence: DoorbellSequence;
  config: DoorbellConfig;
  templates: DoorbellSecretTemplate[];
  now: Date;
  /** Timestamp of the last accepted alert, for the cooldown. */
  lastAlertAtMs: number | null;
  /** True when this eventId has already been processed. */
  duplicate: boolean;
  /** True while the failed-attempt lockout is in force. */
  lockedOut: boolean;
};

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

/** What clients receive. Contains no timing template and no lock credential. */
export type DoorbellAlert = {
  schema: 1;
  id: string;
  dedupeKey: string;
  kind: "visitor" | "authorized" | "failed";
  title: string;
  createdAt: string;
  expiresAt: string;
  sourceDeviceId: string;
  knockCount: number;
};

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
