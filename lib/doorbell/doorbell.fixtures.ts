// Shared builders for the doorbell suites. It is deliberately not a `*.test.*`
// file: vitest collects those by glob, and a helper must not be collected as a
// suite of its own.
import type {
  DoorbellConfig,
  DoorbellKnock,
  DoorbellSecretTemplate,
  DoorbellSequence,
} from "../doorbell";

export function knocks(...at: number[]): DoorbellKnock[] {
  return at.map((atMs) => ({ atMs, peak: 0.7 }));
}

export function sequence(overrides: Partial<DoorbellSequence> = {}): DoorbellSequence {
  return {
    schema: 1,
    eventId: "front-door-abcd1234-1",
    deviceId: "front-door",
    uptimeMs: 100_000,
    presence: true,
    presenceAgeMs: 0,
    knocks: knocks(0, 400, 800),
    noiseFloor: 0.02,
    configVersion: 1,
    ...overrides,
  };
}

export function config(overrides: Partial<DoorbellConfig> = {}): DoorbellConfig {
  return {
    enabled: true,
    deviceId: "front-door",
    fusion: {
      minimumKnocks: 3,
      presenceLeadMs: 2000,
      presenceTrailMs: 2000,
      notificationCooldownMs: 15_000,
    },
    access: {
      enabled: false,
      mode: "notify_only",
      timezone: "Pacific/Auckland",
      requirePresence: true,
      failedAttemptLimit: 5,
      lockoutMs: 900_000,
      ambiguityMargin: 0.2,
      lockEntityId: null,
    },
    schedules: [],
    secrets: [],
    ...overrides,
  };
}

export const baseInput = {
  templates: [] as DoorbellSecretTemplate[],
  now: new Date("2026-08-01T12:00:00.000Z"),
  lastAlertAtMs: null,
  duplicate: false,
  lockedOut: false,
};
