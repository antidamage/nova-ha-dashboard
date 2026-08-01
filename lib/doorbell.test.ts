import { describe, expect, it } from "vitest";
import {
  bestSecretMatch,
  buildAlert,
  decideDoorbell,
  intervalsOf,
  isDoorbellSequence,
  isWithinSchedule,
  localPartsInZone,
  scoreSecret,
  type DoorbellConfig,
  type DoorbellKnock,
  type DoorbellSecretTemplate,
  type DoorbellSequence,
} from "./doorbell";

function knocks(...at: number[]): DoorbellKnock[] {
  return at.map((atMs) => ({ atMs, peak: 0.7 }));
}

function sequence(overrides: Partial<DoorbellSequence> = {}): DoorbellSequence {
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

function config(overrides: Partial<DoorbellConfig> = {}): DoorbellConfig {
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

const baseInput = {
  templates: [] as DoorbellSecretTemplate[],
  now: new Date("2026-08-01T12:00:00.000Z"),
  lastAlertAtMs: null,
  duplicate: false,
  lockedOut: false,
};

describe("isDoorbellSequence", () => {
  it("accepts a well-formed payload", () => {
    expect(isDoorbellSequence(sequence())).toBe(true);
  });

  it("rejects a wrong schema version", () => {
    expect(isDoorbellSequence({ ...sequence(), schema: 2 })).toBe(false);
  });

  it("rejects an empty or absurd knock list", () => {
    expect(isDoorbellSequence({ ...sequence(), knocks: [] })).toBe(false);
    const flood = Array.from({ length: 33 }, (_, i) => ({ atMs: i * 10, peak: 0.5 }));
    expect(isDoorbellSequence({ ...sequence(), knocks: flood })).toBe(false);
  });

  it("rejects non-finite timings", () => {
    expect(
      isDoorbellSequence({ ...sequence(), knocks: [{ atMs: Number.NaN, peak: 0.5 }] }),
    ).toBe(false);
  });
});

describe("intervalsOf", () => {
  it("returns n-1 gaps", () => {
    expect(intervalsOf(knocks(0, 400, 800))).toEqual([400, 400]);
    expect(intervalsOf(knocks(0))).toEqual([]);
  });
});

describe("scoreSecret", () => {
  const template: DoorbellSecretTemplate = {
    id: "shave-and-a-haircut",
    intervals: [200, 200, 400, 200],
    tolerance: 0.25,
    paceRange: [0.65, 1.5],
    sampleCount: 5,
  };

  it("matches the same rhythm exactly", () => {
    const m = scoreSecret(knocks(0, 200, 400, 800, 1000), template);
    expect(m.score).toBeGreaterThan(0.99);
  });

  it("matches the same rhythm performed faster", () => {
    // Every interval scaled by 0.8 — same rhythm, quicker hand.
    const m = scoreSecret(knocks(0, 160, 320, 640, 800), template);
    expect(m.score).toBeGreaterThan(0.9);
  });

  it("rejects a different rhythm at the same total length", () => {
    const m = scoreSecret(knocks(0, 400, 600, 800, 1000), template);
    expect(m.score).toBe(0);
  });

  it("rejects a different knock count outright", () => {
    expect(scoreSecret(knocks(0, 200, 400, 800), template).score).toBe(0);
  });

  it("rejects a performance outside the pace range", () => {
    // Half speed: same shape, but far too slow to be the same credential.
    const m = scoreSecret(knocks(0, 400, 800, 1600, 2000), template);
    expect(m.score).toBe(0);
  });
});

describe("bestSecretMatch", () => {
  const a: DoorbellSecretTemplate = {
    id: "a",
    intervals: [200, 200],
    tolerance: 0.25,
    paceRange: [0.65, 1.5],
    sampleCount: 5,
  };
  const nearlyA: DoorbellSecretTemplate = { ...a, id: "nearly-a", intervals: [205, 205] };
  const b: DoorbellSecretTemplate = { ...a, id: "b", intervals: [500, 150] };

  it("picks the only match", () => {
    const { match, ambiguous } = bestSecretMatch(knocks(0, 200, 400), [a, b], 0.2);
    expect(match?.id).toBe("a");
    expect(ambiguous).toBe(false);
  });

  it("refuses to choose between two close templates", () => {
    const { match, ambiguous } = bestSecretMatch(knocks(0, 200, 400), [a, nearlyA], 0.2);
    expect(match).toBeNull();
    expect(ambiguous).toBe(true);
  });

  it("returns nothing when nothing fits", () => {
    const { match, ambiguous } = bestSecretMatch(knocks(0, 900, 1000), [a], 0.2);
    expect(match).toBeNull();
    expect(ambiguous).toBe(false);
  });
});

describe("localPartsInZone", () => {
  it("resolves NZ daylight time", () => {
    // 2026-01-15 is NZDT (UTC+13).
    const parts = localPartsInZone(new Date("2026-01-15T00:30:00.000Z"), "Pacific/Auckland");
    expect(parts.isoDate).toBe("2026-01-15");
    expect(parts.minutes).toBe(13 * 60 + 30);
  });

  it("resolves NZ standard time", () => {
    // 2026-07-15 is NZST (UTC+12).
    const parts = localPartsInZone(new Date("2026-07-15T00:30:00.000Z"), "Pacific/Auckland");
    expect(parts.isoDate).toBe("2026-07-15");
    expect(parts.minutes).toBe(12 * 60 + 30);
  });

  it("maps midnight to minute zero rather than 24:00", () => {
    const parts = localPartsInZone(new Date("2026-07-14T12:00:00.000Z"), "Pacific/Auckland");
    expect(parts.minutes).toBe(0);
    expect(parts.isoDate).toBe("2026-07-15");
  });
});

describe("isWithinSchedule", () => {
  const weekday = {
    id: "weekdays",
    windows: [{ daysOfWeek: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" }],
    denyDates: [] as string[],
  };

  it("is closed when there are no schedules at all", () => {
    expect(isWithinSchedule(new Date(), "Pacific/Auckland", [])).toBe(false);
  });

  it("opens inside the window", () => {
    // 2026-08-03 is a Monday. 22:00Z Sunday = 10:00 Monday NZST.
    const at = new Date("2026-08-02T22:00:00.000Z");
    expect(isWithinSchedule(at, "Pacific/Auckland", [weekday])).toBe(true);
  });

  it("closes outside the window", () => {
    // 06:00 Monday NZST.
    const at = new Date("2026-08-02T18:00:00.000Z");
    expect(isWithinSchedule(at, "Pacific/Auckland", [weekday])).toBe(false);
  });

  it("honours a deny date", () => {
    const at = new Date("2026-08-02T22:00:00.000Z");
    const denied = { ...weekday, denyDates: ["2026-08-03"] };
    expect(isWithinSchedule(at, "Pacific/Auckland", [denied])).toBe(false);
  });

  it("handles a window that crosses midnight", () => {
    const overnight = {
      id: "overnight",
      windows: [{ daysOfWeek: [5], start: "22:00", end: "02:00" }],
      denyDates: [] as string[],
    };
    // 23:00 Friday NZST -> inside, claimed by Friday's entry.
    expect(
      isWithinSchedule(new Date("2026-08-07T11:00:00.000Z"), "Pacific/Auckland", [overnight]),
    ).toBe(true);
    // 01:00 Saturday NZST -> still inside, claimed by Friday's entry.
    expect(
      isWithinSchedule(new Date("2026-08-07T13:00:00.000Z"), "Pacific/Auckland", [overnight]),
    ).toBe(true);
    // 03:00 Saturday NZST -> closed.
    expect(
      isWithinSchedule(new Date("2026-08-07T15:00:00.000Z"), "Pacific/Auckland", [overnight]),
    ).toBe(false);
  });

  it("fails closed on an unusable time zone", () => {
    expect(isWithinSchedule(new Date(), "Not/AZone", [weekday])).toBe(false);
  });
});

describe("decideDoorbell", () => {
  it("alerts for three knocks with presence", () => {
    const d = decideDoorbell({ ...baseInput, sequence: sequence(), config: config() });
    expect(d.verdict).toBe("visitor");
    expect(d.alerts).toBe(true);
  });

  it("ignores two knocks", () => {
    const d = decideDoorbell({
      ...baseInput,
      sequence: sequence({ knocks: knocks(0, 400) }),
      config: config(),
    });
    expect(d.verdict).toBe("ignored_too_few_knocks");
    expect(d.alerts).toBe(false);
  });

  it("ignores knocks with nobody there", () => {
    const d = decideDoorbell({
      ...baseInput,
      sequence: sequence({ presence: false, presenceAgeMs: 60_000 }),
      config: config(),
    });
    expect(d.verdict).toBe("ignored_no_presence");
    expect(d.alerts).toBe(false);
  });

  it("still alerts when presence lapsed within the trail window", () => {
    const d = decideDoorbell({
      ...baseInput,
      sequence: sequence({ presence: false, presenceAgeMs: 1500 }),
      config: config(),
    });
    expect(d.verdict).toBe("visitor");
  });

  it("ignores a duplicate event id", () => {
    const d = decideDoorbell({ ...baseInput, sequence: sequence(), config: config(), duplicate: true });
    expect(d.verdict).toBe("ignored_duplicate");
  });

  it("ignores a sequence inside the cooldown", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    const d = decideDoorbell({
      ...baseInput,
      now,
      sequence: sequence(),
      config: config(),
      lastAlertAtMs: now.getTime() - 5_000,
    });
    expect(d.verdict).toBe("ignored_cooldown");
  });

  it("does nothing when disabled", () => {
    const d = decideDoorbell({
      ...baseInput,
      sequence: sequence(),
      config: config({ enabled: false }),
    });
    expect(d.verdict).toBe("ignored_disabled");
  });

  describe("with access enabled", () => {
    const template: DoorbellSecretTemplate = {
      id: "guest",
      intervals: [400, 400],
      tolerance: 0.25,
      paceRange: [0.65, 1.5],
      sampleCount: 5,
    };
    const accessConfig = config({
      access: {
        enabled: true,
        mode: "unlock",
        timezone: "Pacific/Auckland",
        requirePresence: true,
        failedAttemptLimit: 5,
        lockoutMs: 900_000,
        ambiguityMargin: 0.2,
        lockEntityId: "lock.front_door",
      },
      schedules: [
        {
          id: "always",
          windows: [{ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" }],
          denyDates: [],
        },
      ],
      secrets: [
        {
          id: "guest",
          label: "Guest",
          configured: true,
          scheduleIds: ["always"],
          maxSuccessfulUses: null,
          successfulUses: 0,
        },
      ],
    });

    it("authorizes a matching secret inside the window", () => {
      const d = decideDoorbell({
        ...baseInput,
        sequence: sequence(),
        config: accessConfig,
        templates: [template],
      });
      expect(d.verdict).toBe("authorized");
      expect(d.secretId).toBe("guest");
    });

    it("falls back to an ordinary visitor alert when the rhythm is wrong", () => {
      const d = decideDoorbell({
        ...baseInput,
        sequence: sequence({ knocks: knocks(0, 150, 900) }),
        config: accessConfig,
        templates: [template],
      });
      // Indistinguishable from any other visitor — a near miss must not leak.
      expect(d.verdict).toBe("visitor");
    });

    it("does not unlock while locked out", () => {
      const d = decideDoorbell({
        ...baseInput,
        sequence: sequence(),
        config: accessConfig,
        templates: [template],
        lockedOut: true,
      });
      expect(d.verdict).toBe("visitor");
    });

    it("does not unlock outside the schedule", () => {
      const nightOnly = {
        ...accessConfig,
        schedules: [
          {
            id: "always",
            windows: [{ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], start: "02:00", end: "03:00" }],
            denyDates: [],
          },
        ],
      };
      const d = decideDoorbell({
        ...baseInput,
        sequence: sequence(),
        config: nightOnly,
        templates: [template],
      });
      expect(d.verdict).toBe("visitor");
    });

    it("does not unlock when the secret is out of uses", () => {
      const spent = {
        ...accessConfig,
        secrets: [{ ...accessConfig.secrets[0], maxSuccessfulUses: 1, successfulUses: 1 }],
      };
      const d = decideDoorbell({
        ...baseInput,
        sequence: sequence(),
        config: spent,
        templates: [template],
      });
      expect(d.verdict).toBe("visitor");
    });

    it("does not unlock when no lock entity is bound", () => {
      const noLock = {
        ...accessConfig,
        access: { ...accessConfig.access, lockEntityId: null },
      };
      const d = decideDoorbell({
        ...baseInput,
        sequence: sequence(),
        config: noLock,
        templates: [template],
      });
      expect(d.verdict).toBe("visitor");
    });

    it("does not unlock on an ambiguous match", () => {
      const d = decideDoorbell({
        ...baseInput,
        sequence: sequence(),
        config: {
          ...accessConfig,
          secrets: [
            accessConfig.secrets[0],
            { ...accessConfig.secrets[0], id: "twin", label: "Twin" },
          ],
        },
        templates: [template, { ...template, id: "twin", intervals: [402, 402] }],
      });
      expect(d.verdict).toBe("visitor");
    });
  });
});

describe("buildAlert", () => {
  it("carries no timing template or lock detail", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    const alert = buildAlert(sequence(), { verdict: "visitor", reason: "ok", alerts: true }, now, 12_000);
    expect(alert.kind).toBe("visitor");
    expect(alert.knockCount).toBe(3);
    expect(alert.expiresAt).toBe("2026-08-01T12:00:12.000Z");
    expect(JSON.stringify(alert)).not.toContain("atMs");
    expect(JSON.stringify(alert)).not.toContain("interval");
  });

  it("labels an authorized entry differently", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    const alert = buildAlert(
      sequence(),
      { verdict: "authorized", reason: "ok", secretId: "guest", alerts: true },
      now,
      12_000,
    );
    expect(alert.kind).toBe("authorized");
    expect(JSON.stringify(alert)).not.toContain("guest");
  });
});
