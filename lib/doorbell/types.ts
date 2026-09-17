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
