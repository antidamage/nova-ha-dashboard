import { describe, expect, it } from "vitest";
import { formatBillingDate, pathForPoints, usagePointValue } from "./power-format";

describe("power formatting helpers", () => {
  it("formats billing dates without changing invalid labels", () => {
    expect(formatBillingDate("2026-06-18")).toBe("18 Jun");
    expect(formatBillingDate("not-a-date")).toBe("not-a-date");
  });

  it("keeps curve paths deterministic", () => {
    expect(pathForPoints([{ label: "a", value: 1 }, { label: "b", value: 2 }], (point) => point.value)).toBe(
      "M 0.00 19.00 C 50.00 19.00, 50.00 0.00, 100.00 0.00",
    );
  });

  it("uses cost for credit mode and kWh for kWh mode", () => {
    const point = { costNzd: 3, kwh: 2, label: "today" };

    expect(usagePointValue(point, "credits")).toBe(3);
    expect(usagePointValue(point, "kwh")).toBe(2);
  });
});
