import { describe, expect, it } from "vitest";
import { readDefaultDashboardConfig } from "./dashboard-config";

/**
 * The climate cards used to name this house's rooms outright — the components
 * said "Lounge" and "Bedroom" — and rendered even when the home had no such
 * device, so a fresh install showed an empty card headed "Bedroom" holding
 * controls that did nothing.
 *
 * Titles are config now, and each card renders only when its device exists.
 * These assertions pin the shipped side of that; the rendering condition lives
 * in app/components/dashboard/ClimateControls.tsx.
 */
describe("climate card configuration", () => {
  it("ships titles that describe the device, not one house's rooms", async () => {
    const config = await readDefaultDashboardConfig();

    expect(config.dashboard.aircon.title).toBe("Climate");
    expect(config.dashboard.bedroomHeater.title).toBe("Heater");

    for (const title of [config.dashboard.aircon.title, config.dashboard.bedroomHeater.title]) {
      expect(title.toLowerCase()).not.toMatch(/lounge|bedroom|kitchen|conservatory|hallway/);
    }
  });

  it("ships no heater entities, so the card is absent until a home configures one", async () => {
    const config = await readDefaultDashboardConfig();

    expect(config.dashboard.bedroomHeater.switchEntityIds).toEqual([]);
    expect(config.dashboard.bedroomHeater.temperatureEntityIds).toEqual([]);
  });

  it("keeps a title even when a home supplies none, so the card is never nameless", async () => {
    const { validateDashboardConfig } = await import("./dashboard-config");
    const defaults = await readDefaultDashboardConfig();

    const result = validateDashboardConfig({
      ...defaults,
      dashboard: {
        ...defaults.dashboard,
        bedroomHeater: { switchEntityIds: ["switch.study_heater"], temperatureEntityIds: [], humidityEntityIds: [] },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.config.dashboard.bedroomHeater.title).toBe("Heater");
  });
});
