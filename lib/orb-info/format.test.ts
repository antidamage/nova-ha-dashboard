import { describe, expect, it } from "vitest";
import cases from "./format-cases.json";
import { DEFAULT_ORB_DISPLAY, formatOrbValue, msUntilDisplayChange } from "./format";
import { ORB_MODULE_OUTPUT_EMPTY, type OrbInfoDisplay, type OrbModuleOutput } from "./types";

function outputFrom(raw: Record<string, unknown>): OrbModuleOutput {
  return { ...ORB_MODULE_OUTPUT_EMPTY, ...raw } as OrbModuleOutput;
}

function displayFrom(raw: Record<string, unknown>): OrbInfoDisplay {
  return { ...DEFAULT_ORB_DISPLAY, ...raw } as OrbInfoDisplay;
}

describe("formatOrbValue — shared conformance table", () => {
  // The Swift port runs this same table. A failure here means the two surfaces
  // would render the same reading differently.
  for (const testCase of cases.cases) {
    it(testCase.name, () => {
      const result = formatOrbValue(
        outputFrom(testCase.output as Record<string, unknown>),
        displayFrom(testCase.display as Record<string, unknown>),
        { label: "Test" },
      );
      expect(result.text).toBe(testCase.expectText);
      expect(result.alert).toBe(testCase.expectAlert);
    });
  }
});

describe("formatOrbValue — accessibility", () => {
  it("describes a missing reading rather than reading out the empty glyph", () => {
    const result = formatOrbValue(
      outputFrom({ value: null, baseUnit: "hours", status: "unavailable" }),
      displayFrom({ format: "duration" }),
      { label: "Gym" },
    );
    expect(result.ariaLabel).toBe("Gym: no reading.");
  });

  it("includes the module detail when present", () => {
    const result = formatOrbValue(
      outputFrom({ value: 12, baseUnit: "hours", status: "ok", detail: "Last visit Tuesday." }),
      displayFrom({ format: "duration", unit: "hours" }),
      { label: "Gym" },
    );
    expect(result.ariaLabel).toContain("Last visit Tuesday.");
  });
});

describe("msUntilDisplayChange", () => {
  const observedAt = "2026-08-15T00:00:00.000Z";
  const base = Date.parse(observedAt);

  it("wakes on the hour boundary at zero decimals", () => {
    const output = outputFrom({ value: 1, baseUnit: "hours", status: "ok", observedAt });
    const display = displayFrom({ format: "duration", unit: "hours", decimals: 0 });
    // 90 minutes in: the next whole hour is 30 minutes away.
    const ms = msUntilDisplayChange(output, display, base + 90 * 60_000);
    expect(ms).toBeGreaterThan(29 * 60_000);
    expect(ms).toBeLessThan(31 * 60_000);
  });

  it("wakes ten times as often at one decimal place", () => {
    const output = outputFrom({ value: 1, baseUnit: "hours", status: "ok", observedAt });
    const display = displayFrom({ format: "duration", unit: "hours", decimals: 1 });
    // Six-minute steps: 90 minutes in, the next step is 6 minutes away.
    const ms = msUntilDisplayChange(output, display, base + 90 * 60_000);
    expect(ms).toBeGreaterThan(5 * 60_000);
    expect(ms).toBeLessThan(7 * 60_000);
  });

  it("ticks every minute for a clock without seconds", () => {
    const display = displayFrom({ format: "clock", clockSeconds: false });
    const ms = msUntilDisplayChange(outputFrom({ value: base, baseUnit: "timestamp" }), display, base + 30_000);
    expect(ms).toBeGreaterThan(29_000);
    expect(ms).toBeLessThanOrEqual(30_100);
  });

  it("ticks every second for a clock with seconds", () => {
    const display = displayFrom({ format: "clock", clockSeconds: true });
    const ms = msUntilDisplayChange(outputFrom({ value: base, baseUnit: "timestamp" }), display, base + 30_250);
    expect(ms).toBeGreaterThan(700);
    expect(ms).toBeLessThanOrEqual(800);
  });

  it("returns null when there is nothing that would change", () => {
    const output = outputFrom({ value: 5, baseUnit: "count", status: "ok", observedAt });
    const display = displayFrom({ format: "number" });
    expect(msUntilDisplayChange(output, display, base)).toBeNull();
  });
});
