import { describe, expect, it } from "vitest";
import {
  airconPreferencesFor,
  airconPreferencesPatch,
  heaterPreferencesFor,
  heaterPreferencesPatch,
} from "./climate-preferences";
import type { DashboardPreferences } from "./types";

describe("climate instance preferences", () => {
  const stored: DashboardPreferences = {
    aircon: { temperature: 22, autoMode: true },
    bedroomHeater: { mode: "auto", temperature: 18 },
    climate: {
      study: { aircon: { temperature: 20 } },
      garage_heater: { heater: { mode: "off", temperature: 12 } },
    },
  } as unknown as DashboardPreferences;

  it("reads the first of each kind from the historical keys", () => {
    // This is the property that means a live installation keeps its settings.
    expect(airconPreferencesFor(stored, "lounge")?.temperature).toBe(22);
    expect(heaterPreferencesFor(stored, "bedroom")?.temperature).toBe(18);
  });

  it("reads further instances from their own entry", () => {
    expect(airconPreferencesFor(stored, "study")?.temperature).toBe(20);
    expect(heaterPreferencesFor(stored, "garage_heater")?.temperature).toBe(12);
  });

  it("returns nothing for an instance with no stored settings yet", () => {
    expect(airconPreferencesFor(stored, "loft")).toBeUndefined();
    expect(heaterPreferencesFor(undefined, "loft")).toBeUndefined();
  });

  it("writes the first of each kind back to the historical keys", () => {
    expect(airconPreferencesPatch("lounge", { temperature: 21 })).toEqual({ aircon: { temperature: 21 } });
    expect(heaterPreferencesPatch("bedroom", { mode: "off" })).toEqual({ bedroomHeater: { mode: "off" } });
  });

  it("writes further instances under their own id", () => {
    expect(airconPreferencesPatch("study", { temperature: 19 })).toEqual({
      climate: { study: { aircon: { temperature: 19 } } },
    });
    expect(heaterPreferencesPatch("garage_heater", { mode: "auto" })).toEqual({
      climate: { garage_heater: { heater: { mode: "auto" } } },
    });
  });
});
