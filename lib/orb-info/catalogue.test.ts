import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORB_INFO_MODULES, orbModuleById, type OrbInfoSources } from "./catalogue";
import { formatOrbValue } from "./format";
import { resolveOrbDisplay } from "./preferences";

const NOW = Date.parse("2026-08-15T12:00:00.000Z");

const EMPTY_STATE: NonNullable<OrbInfoSources["dashboardState"]> = {
  outsideTemperature: null, outsideFeelsLike: null, humidity: null, rainChancePct: null,
  uvIndex: null, windSpeed: null, forecastHigh: null, forecastLow: null,
  nextSetting: null, nextRising: null, sunState: null, haHealthy: true, wanConnected: null,
  lightsOn: null, openingsOpen: null, unavailableCount: null, generatedAt: null,
  zones: [], numericEntities: [],
};

function sources(overrides: Partial<OrbInfoSources> = {}): OrbInfoSources {
  return {
    now: NOW,
    watchface: null,
    novaLoad: null,
    power: null,
    dashboardState: null,
    tasks: null,
    ...overrides,
  };
}

function gymSources(hoursAgo: number, thresholdHours = 46) {
  return sources({
    watchface: {
      gymLastResetAt: NOW - hoursAgo * 3_600_000,
      gymAlertThresholdHours: thresholdHours,
    },
  });
}

describe("catalogue integrity", () => {
  it("declares every module's default format as supported", () => {
    for (const module of ORB_INFO_MODULES) {
      expect(module.supportedFormats).toContain(module.defaultDisplay.format);
    }
  });

  it("gives every module a unique id", () => {
    const ids = ORB_INFO_MODULES.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns an unavailable output from every module when no source has data", () => {
    for (const module of ORB_INFO_MODULES) {
      // The clock reads the device itself, so it is never without a value.
      // (`since-date` also uses the clock but still needs its date parameter,
      // so it is deliberately NOT exempt.)
      if (module.id === "clock") continue;
      const output = module.read(sources());
      // No module may invent a reading out of nothing — that is how a 0 ends up
      // on the orb pretending to be real data.
      expect(output.value === null || output.status === "unavailable").toBe(true);
    }
  });
});

describe("tvOS catalogue parity", () => {
  // The Apple TV keeps its own catalogue (it has different data sources), but
  // the module IDS must match: a module missing there means selecting it on the
  // dashboard silently falls back to the gym counter on the TV.
  const swiftPath = path.resolve(
    __dirname,
    "../../../nova-appletv-dashboard/NovaAppleTVDashboard/OrbInfoModules.swift",
  );

  it.skipIf(!existsSync(swiftPath))("offers the same module ids on both surfaces", () => {
    const swift = readFileSync(swiftPath, "utf8");
    const swiftIds = [...swift.matchAll(/OrbInfoModule\(id: "([^"]+)"/g)].map((match) => match[1]);
    const webIds = ORB_INFO_MODULES.map((module) => module.id);

    expect(swiftIds.filter((id) => !webIds.includes(id))).toEqual([]);
    expect(webIds.filter((id) => !swiftIds.includes(id))).toEqual([]);
  });
});

describe("gym module", () => {
  it("reproduces the original whole-hours readout at its default display", () => {
    const module = orbModuleById("gym");
    const display = resolveOrbDisplay(undefined, "gym");
    // 46.75 hours elapsed: the pre-module orb floored this to 46.
    const result = formatOrbValue(module.read(gymSources(46.75)), display);
    expect(result.text).toBe("46");
  });

  it("alerts at exactly the threshold, not a moment later", () => {
    const module = orbModuleById("gym");
    expect(module.read(gymSources(45.99)).alert).toBe(false);
    expect(module.read(gymSources(46)).alert).toBe(true);
    expect(module.read(gymSources(46.01)).alert).toBe(true);
  });

  it("reports no reading before the first scrape lands", () => {
    const module = orbModuleById("gym");
    const output = module.read(sources({ watchface: { gymLastResetAt: null, gymAlertThresholdHours: 46 } }));
    expect(output.value).toBeNull();
    expect(output.status).toBe("unavailable");
    // And it must render the empty glyph, never a misleading 0.
    expect(formatOrbValue(output, resolveOrbDisplay(undefined, "gym")).text).toBe("—");
  });

  it("carries the threshold so a percentage display has a basis", () => {
    expect(orbModuleById("gym").read(gymSources(23)).alertThreshold).toBe(46);
  });
});

describe("gym-progress module", () => {
  it("reads out the percentage of the way to the threshold", () => {
    const module = orbModuleById("gym-progress");
    const display = resolveOrbDisplay(undefined, "gym-progress");
    expect(formatOrbValue(module.read(gymSources(23)), display).text).toBe("50%");
    expect(formatOrbValue(module.read(gymSources(46)), display).text).toBe("100%");
  });

  it("clamps past the threshold by default rather than running away", () => {
    const module = orbModuleById("gym-progress");
    const display = resolveOrbDisplay(undefined, "gym-progress");
    expect(formatOrbValue(module.read(gymSources(200)), display).text).toBe("100%");
  });
});

describe("host modules", () => {
  const novaLoad = { cpu: 0.42, gpu: 0.9, net: 0.05, load: 0.9, listening: false, ts: NOW };

  it("reports each host metric as a percentage", () => {
    const withLoad = sources({ novaLoad });
    expect(formatOrbValue(orbModuleById("host-cpu").read(withLoad), resolveOrbDisplay(undefined, "host-cpu")).text)
      .toBe("42%");
    expect(formatOrbValue(orbModuleById("host-gpu").read(withLoad), resolveOrbDisplay(undefined, "host-gpu")).text)
      .toBe("90%");
  });

  it("reports no reading when the load poll has not answered", () => {
    expect(orbModuleById("host-cpu").read(sources()).status).toBe("unavailable");
  });
});

describe("power modules", () => {
  it("reads the live household usage rate in kilowatts", () => {
    const withPower = sources({
      power: { currentWatts: 1450, currentCostPerHourNzd: 0.42, generatedAt: null },
    });
    expect(formatOrbValue(orbModuleById("power-draw").read(withPower), resolveOrbDisplay(undefined, "power-draw")).text)
      .toBe("1.45kW");
    expect(
      formatOrbValue(orbModuleById("power-cost-rate").read(withPower), resolveOrbDisplay(undefined, "power-cost-rate")).text,
    ).toBe("$0.42");
  });
});

describe("system modules", () => {
  it("alerts when a device is unreachable", () => {
    const state = { ...EMPTY_STATE, lightsOn: 3, unavailableCount: 2 };
    const output = orbModuleById("devices-unavailable").read(sources({ dashboardState: state }));
    expect(output.value).toBe(2);
    expect(output.alert).toBe(true);
    expect(orbModuleById("devices-unavailable").read(
      sources({ dashboardState: { ...state, unavailableCount: 0 } }),
    ).alert).toBe(false);
  });

  it("renders degraded Home Assistant state as words", () => {
    const state = { ...EMPTY_STATE, haHealthy: false };
    const output = orbModuleById("ha-health").read(sources({ dashboardState: state }));
    expect(formatOrbValue(output, resolveOrbDisplay(undefined, "ha-health")).text).toBe("DEG");
    expect(output.alert).toBe(true);
  });
});

describe("parameterised modules", () => {
  const state: NonNullable<OrbInfoSources["dashboardState"]> = {
    ...EMPTY_STATE,
    outsideTemperature: 8, outsideFeelsLike: 6, humidity: 70, rainChancePct: 20,
    uvIndex: 3, windSpeed: 12, forecastHigh: 14, forecastLow: 5,
    wanConnected: true, lightsOn: 3, openingsOpen: 1, unavailableCount: 0,
    zones: [
      { id: "lounge", name: "Lounge", temperatureC: 21.4, humidityPct: 55 },
      { id: "bedroom", name: "Bedroom", temperatureC: 18, humidityPct: null },
    ],
    numericEntities: [
      { entityId: "sensor.tank", name: "Tank", value: 62.5, unit: "%" },
      { entityId: "sensor.fridge", name: "Fridge", value: 3.2, unit: "°C" },
    ],
  };

  it("reads the chosen zone, not the first one", () => {
    const module = orbModuleById("zone-temperature");
    const display = resolveOrbDisplay(undefined, "zone-temperature");
    expect(formatOrbValue(module.read(sources({ dashboardState: state }), { zoneId: "bedroom" }), display).text)
      .toBe("18.0°C");
    expect(formatOrbValue(module.read(sources({ dashboardState: state }), { zoneId: "lounge" }), display).text)
      .toBe("21.4°C");
  });

  it("reports no reading when the chosen zone has no sensor", () => {
    const output = orbModuleById("zone-humidity").read(sources({ dashboardState: state }), { zoneId: "bedroom" });
    expect(output.status).toBe("unavailable");
  });

  it("reports no reading when no zone has been chosen at all", () => {
    expect(orbModuleById("zone-temperature").read(sources({ dashboardState: state }), {}).status)
      .toBe("unavailable");
  });

  it("signs the indoor/outdoor delta so the direction is the answer", () => {
    const module = orbModuleById("indoor-outdoor-delta");
    const display = resolveOrbDisplay(undefined, "indoor-outdoor-delta");
    // Lounge 21.4 vs outside 8.
    expect(formatOrbValue(module.read(sources({ dashboardState: state }), { zoneId: "lounge" }), display).text)
      .toBe("+13.4°C");
  });

  it("adopts the sensor's own unit for a generic entity readout", () => {
    const module = orbModuleById("entity-numeric");
    // A °C sensor must convert like a temperature...
    const fridge = module.read(sources({ dashboardState: state }), { entityId: "sensor.fridge" });
    expect(fridge.baseUnit).toBe("celsius");
    expect(formatOrbValue(fridge, { ...resolveOrbDisplay(undefined, "entity-numeric"), format: "temperature", unit: "fahrenheit", decimals: 1, showUnit: true }).text)
      .toBe("37.8°F");
    // ...and a % sensor is already a percentage, not a ratio to be scaled.
    const tank = module.read(sources({ dashboardState: state }), { entityId: "sensor.tank" });
    expect(tank.baseUnit).toBe("percent");
    expect(formatOrbValue(tank, { ...resolveOrbDisplay(undefined, "entity-numeric"), format: "percent", decimals: 0, rounding: "round", showUnit: true }).text)
      .toBe("63%");
  });

  it("counts from a chosen date and only alerts when told to", () => {
    const module = orbModuleById("since-date");
    const display = resolveOrbDisplay(undefined, "since-date");
    const since = new Date(NOW - 10 * 24 * 3_600_000).toISOString();
    expect(formatOrbValue(module.read(sources(), { since }), display).text).toBe("10d");
    // 0 days means "never alert", not "alert immediately".
    expect(module.read(sources(), { since, alertAfterDays: 0 }).alert).toBe(false);
    expect(module.read(sources(), { since, alertAfterDays: 7 }).alert).toBe(true);
    expect(module.read(sources(), { since, alertAfterDays: 30 }).alert).toBe(false);
  });

  it("uses the configured ceiling as the power percentage basis", () => {
    const module = orbModuleById("power-headroom");
    const display = resolveOrbDisplay(undefined, "power-headroom");
    const withPower = sources({ power: { currentWatts: 2500, currentCostPerHourNzd: null, generatedAt: null } });
    expect(formatOrbValue(module.read(withPower, { ceilingWatts: 5000 }), display).text).toBe("50%");
    // Unclamped by default: going over the ceiling must be visible.
    expect(formatOrbValue(module.read(withPower, { ceilingWatts: 2000 }), display).text).toBe("125%");
    expect(module.read(withPower, { ceilingWatts: 2000 }).alert).toBe(true);
  });
});

describe("reminder modules", () => {
  it("counts down to the next reminder and flags overdue ones", () => {
    const tasks = { nextDueInHours: 2.5, nextDueAt: null, overdueCount: 0 };
    const next = orbModuleById("next-reminder").read(sources({ tasks }));
    expect(formatOrbValue(next, resolveOrbDisplay(undefined, "next-reminder")).text).toBe("2h");

    const overdue = orbModuleById("reminders-overdue").read(sources({ tasks: { ...tasks, overdueCount: 3 } }));
    expect(overdue.value).toBe(3);
    expect(overdue.alert).toBe(true);
  });

  it("shows no reading when there is no next reminder", () => {
    const output = orbModuleById("next-reminder").read(
      sources({ tasks: { nextDueInHours: null, nextDueAt: null, overdueCount: 0 } }),
    );
    expect(output.status).toBe("unavailable");
  });
});

describe("none module", () => {
  it("produces nothing to render", () => {
    const output = orbModuleById("none").read(sources());
    expect(output.value).toBeNull();
    expect(output.text).toBeNull();
    expect(output.alert).toBe(false);
  });
});
