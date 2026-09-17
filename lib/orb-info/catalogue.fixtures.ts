// Shared source builders for the orb-info catalogue suites. It is deliberately
// not a `*.test.*` file: vitest collects those by glob, and a helper must not
// be collected as a suite of its own.
import type { OrbInfoSources } from "./catalogue";

export const NOW = Date.parse("2026-08-15T12:00:00.000Z");

export const EMPTY_STATE: NonNullable<OrbInfoSources["dashboardState"]> = {
  outsideTemperature: null, outsideFeelsLike: null, humidity: null, rainChancePct: null,
  uvIndex: null, windSpeed: null, forecastHigh: null, forecastLow: null,
  nextSetting: null, nextRising: null, sunState: null, haHealthy: true, wanConnected: null,
  lightsOn: null, openingsOpen: null, unavailableCount: null, generatedAt: null,
  zones: [], numericEntities: [],
};

export function sources(overrides: Partial<OrbInfoSources> = {}): OrbInfoSources {
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

export function gymSources(hoursAgo: number, thresholdHours = 46) {
  return sources({
    watchface: {
      gymLastResetAt: NOW - hoursAgo * 3_600_000,
      gymAlertThresholdHours: thresholdHours,
    },
  });
}
