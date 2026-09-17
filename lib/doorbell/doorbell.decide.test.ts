import { describe, expect, it } from "vitest";
import {
  decideDoorbell,
  type DoorbellSecretTemplate,
} from "../doorbell";
import { baseInput, config, knocks, sequence } from "./doorbell.fixtures";

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
