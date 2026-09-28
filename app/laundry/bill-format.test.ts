import { describe, expect, it } from "vitest";
import { claimBackground, kwh, money, secondsLabel, temperatureLabel, watts } from "./bill-format";

/**
 * How the laundry pages write a wash (specs/power-meters.md §5.3).
 *
 * The one figure worth pinning is the claim colour's own gradient: the row has to be
 * marked *subtly*, and the failure that hides here is a gradient to `transparent` —
 * which interpolates through grey and quietly desaturates the person's colour.
 */

describe("the colour a claimed row wears", () => {
  it("is a vertical gradient from clear to 20% of the person's own colour", () => {
    expect(claimBackground("#ff4d2e")).toBe("linear-gradient(180deg, #ff4d2e00, #ff4d2e33)");
  });

  it("is no background at all when nobody claimed the wash", () => {
    // The bill's own paper, rather than a colour standing for "nobody".
    expect(claimBackground(undefined)).toBeUndefined();
  });
});

describe("the bill's figures", () => {
  it("writes energy to the precision a wash is worth", () => {
    expect(kwh(0.057)).toBe("0.057 kWh");
    expect(kwh(1.24)).toBe("1.24 kWh");
  });

  it("writes money and watts plainly", () => {
    expect(money(0.11)).toBe("$0.11");
    expect(watts(2185.4)).toBe("2185 W");
  });

  it("writes a heat-up to the second", () => {
    expect(secondsLabel(487)).toBe("8m 7s");
    expect(secondsLabel(42)).toBe("42s");
  });

  it("writes a temperature as the button, or says nothing was measured", () => {
    expect(temperatureLabel({ degrees: 40, heatUp: { open: false, seconds: 899, watts: 2160 }, source: "degrees" })).toBe("40°");
    expect(temperatureLabel({ degrees: null, heatUp: { open: false, seconds: 0, watts: 0 }, source: "cold" })).toBe("Cold");
    expect(temperatureLabel({ degrees: null, heatUp: { open: false, seconds: 0, watts: 0 }, source: "unmeasured" })).toBe("—");
  });
});
