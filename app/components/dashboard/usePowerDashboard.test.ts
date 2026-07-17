import { describe, expect, it } from "vitest";
import { normalizePowerDashboard, zeroPowerDashboard } from "./usePowerDashboard";

describe("power dashboard fallback", () => {
  it("zeros out missing grid data", () => {
    const now = new Date("2026-06-06T01:23:45.000Z");
    const result = normalizePowerDashboard({ summary: { totalKwh: 42 } }, now);

    expect(result.error).toBe("Grid data unavailable; showing zeros");
    expect(result.data.currentWatts).toBe(0);
    expect(result.data.currentRate.cPerKwh).toBe(0);
    expect(result.data.summaries.month.projectedKwh).toBe(0);
    expect(result.data.generatedAt).toBe(now.toISOString());
  });

  it("keeps a complete power dashboard payload", () => {
    const payload = zeroPowerDashboard(new Date("2026-06-06T01:23:45.000Z"));

    const result = normalizePowerDashboard(payload);

    expect(result.error).toBeNull();
    expect(result.data).toBe(payload);
  });
});
