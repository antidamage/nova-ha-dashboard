import { describe, expect, it } from "vitest";
import { powerModule, powerModuleConfigured } from "./module";
import type { ModuleStateContext } from "../types";
import type { DashboardConfig } from "../../config-schema";

function contextWith(power: Partial<DashboardConfig["power"]>): ModuleStateContext {
  return {
    config: {
      power: {
        rates: {},
        deviceRatings: [],
        accountHistory: [],
        ...power,
      },
    } as unknown as DashboardConfig,
    states: [],
    registry: {} as ModuleStateContext["registry"],
    index: {} as ModuleStateContext["index"],
    entities: [],
    warnings: [],
  };
}

const TARIFF = {
  planName: "Standard residential",
  dailyCents: 250,
  anytimeCPerKwh: Array(12).fill(28),
  peakCPerKwh: Array(12).fill(40),
  offPeakCPerKwh: Array(12).fill(20),
  historicalAnytimeCPerKwh: [],
};

const RATING = {
  id: "study_lamp",
  name: "Study lamp",
  zone: "Study",
  kind: "light" as const,
  entityIds: ["light.study_lamp"],
  ratedWatts: 9,
  confidence: "high" as const,
  source: "Manufacturer specification",
};

describe("power module", () => {
  it("is inactive on a fresh install, and says what is missing", () => {
    const status = powerModule.status!(contextWith({}));

    expect(status.active).toBe(false);
    expect(status.requirements.every((requirement) => !requirement.ok)).toBe(true);
    expect(status.requirements.map((requirement) => requirement.label)).toEqual([
      "Electricity plan",
      "Device ratings",
    ]);
  });

  it("stays inactive with a tariff but nothing to meter", () => {
    const status = powerModule.status!(contextWith({ rates: { tariff: TARIFF } }));

    expect(status.active).toBe(false);
    expect(status.requirements.find((r) => r.label === "Electricity plan")?.ok).toBe(true);
    expect(status.requirements.find((r) => r.label === "Device ratings")?.ok).toBe(false);
  });

  it("stays inactive with devices but no plan, rather than pricing kWh at zero", () => {
    const status = powerModule.status!(contextWith({ deviceRatings: [RATING] }));

    expect(status.active).toBe(false);
    expect(status.requirements.find((r) => r.label === "Electricity plan")?.ok).toBe(false);
  });

  it("activates once both halves are configured", () => {
    const status = powerModule.status!(contextWith({ rates: { tariff: TARIFF }, deviceRatings: [RATING] }));

    expect(status.active).toBe(true);
    expect(status.summary).toContain("Standard residential");
  });

  it("exposes the same verdict to the client zone list", () => {
    expect(powerModuleConfigured({ rates: {}, deviceRatings: [] })).toBe(false);
    expect(powerModuleConfigured({ rates: { tariff: TARIFF }, deviceRatings: [] })).toBe(false);
    expect(powerModuleConfigured({ rates: { tariff: TARIFF }, deviceRatings: [RATING] })).toBe(true);
  });
});
