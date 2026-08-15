import { describe, expect, it } from "vitest";
import { ORB_INFO_MODULES, orbModuleById, type OrbInfoSources } from "./catalogue";
import { formatOrbValue } from "./format";
import { resolveOrbDisplay } from "./preferences";

const NOW = Date.parse("2026-08-15T12:00:00.000Z");

function sources(overrides: Partial<OrbInfoSources> = {}): OrbInfoSources {
  return {
    now: NOW,
    watchface: null,
    novaLoad: null,
    power: null,
    dashboardState: null,
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
      if (module.sources.includes("clock")) continue;
      const output = module.read(sources());
      // No module may invent a reading out of nothing — that is how a 0 ends up
      // on the orb pretending to be real data.
      expect(output.value === null || output.status === "unavailable").toBe(true);
    }
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
    const state = {
      outsideTemperature: null, outsideFeelsLike: null, humidity: null, rainChancePct: null,
      nextSetting: null, nextRising: null, sunState: null, haHealthy: true,
      lightsOn: 3, unavailableCount: 2, generatedAt: null,
    };
    const output = orbModuleById("devices-unavailable").read(sources({ dashboardState: state }));
    expect(output.value).toBe(2);
    expect(output.alert).toBe(true);
    expect(orbModuleById("devices-unavailable").read(
      sources({ dashboardState: { ...state, unavailableCount: 0 } }),
    ).alert).toBe(false);
  });

  it("renders degraded Home Assistant state as words", () => {
    const state = {
      outsideTemperature: null, outsideFeelsLike: null, humidity: null, rainChancePct: null,
      nextSetting: null, nextRising: null, sunState: null, haHealthy: false,
      lightsOn: null, unavailableCount: null, generatedAt: null,
    };
    const output = orbModuleById("ha-health").read(sources({ dashboardState: state }));
    expect(formatOrbValue(output, resolveOrbDisplay(undefined, "ha-health")).text).toBe("DEG");
    expect(output.alert).toBe(true);
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
