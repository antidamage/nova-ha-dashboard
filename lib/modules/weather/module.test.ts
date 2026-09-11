import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardConfig } from "../../config-schema";
import type { HaState } from "../../types";

const callServiceWithResponse = vi.fn();
vi.mock("../../ha/client", () => ({ callServiceWithResponse: (...args: unknown[]) => callServiceWithResponse(...args) }));

const config = {
  homeAssistant: { weatherEntityId: "weather.home" },
  dashboard: { timing: { weatherRefreshIntervalMs: 60_000 } },
} as unknown as DashboardConfig;

vi.mock("../../dashboard-config", () => ({ readDashboardConfig: async () => config }));

const { buildWeatherStatus, resetWeatherCacheForTests, warmWeatherCache } = await import("./module");

function weather(state: string, temperature?: number): HaState {
  return {
    entity_id: "weather.home",
    state,
    attributes: temperature === undefined ? {} : { temperature, humidity: 70 },
  } as HaState;
}

function forecastResponse(high: number) {
  return { service_response: { "weather.home": { forecast: [{ condition: "rainy", temperature: high, templow: 9 }] } } };
}

describe("weather refresh (specs/weather-refresh.md)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T08:00:00Z"));
    callServiceWithResponse.mockReset();
    resetWeatherCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks HA at most once per interval however often state is built", async () => {
    callServiceWithResponse.mockResolvedValue(forecastResponse(14));
    for (let i = 0; i < 20; i += 1) {
      await buildWeatherStatus([weather("rainy", 13)], [], config);
      vi.advanceTimersByTime(3_000); // 57 s in total, inside one interval
    }
    expect(callServiceWithResponse).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    await buildWeatherStatus([weather("rainy", 13)], [], config);
    expect(callServiceWithResponse).toHaveBeenCalledTimes(2);
  });

  it("caches a failure for the interval instead of retrying", async () => {
    callServiceWithResponse.mockRejectedValue(new Error("Home Assistant 500"));
    const warnings: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      await buildWeatherStatus([weather("rainy", 13)], warnings, config);
    }
    expect(callServiceWithResponse).toHaveBeenCalledTimes(1);
    expect(warnings[0]).toBe("Weather forecast unavailable: Home Assistant 500");
  });

  it("does not call HA while the entity is unavailable, including from the background timer", async () => {
    const warnings: string[] = [];
    const status = await buildWeatherStatus([weather("unavailable")], warnings, config);
    await warmWeatherCache();
    expect(callServiceWithResponse).not.toHaveBeenCalled();
    expect(status?.condition).toBe("unavailable");
    expect(warnings).toEqual(["Weather entity unavailable."]);
  });

  it("returns the last good status when the entity goes unavailable or the forecast fails", async () => {
    callServiceWithResponse.mockResolvedValueOnce(forecastResponse(14));
    const good = await buildWeatherStatus([weather("rainy", 13)], [], config);
    expect(good).toMatchObject({ condition: "rainy", temperature: 13, high: 14, low: 9 });

    const whileDown = await buildWeatherStatus([weather("unavailable")], [], config);
    expect(whileDown).toEqual(good);

    vi.advanceTimersByTime(70_000);
    callServiceWithResponse.mockRejectedValueOnce(new Error("Home Assistant 500"));
    const warnings: string[] = [];
    const afterFailure = await buildWeatherStatus([weather("rainy", 12)], warnings, config);
    expect(afterFailure).toEqual(good);
    expect(warnings).toEqual(["Weather forecast unavailable: Home Assistant 500"]);
  });

  it("fetches again as soon as the entity comes back", async () => {
    callServiceWithResponse.mockRejectedValueOnce(new Error("Home Assistant 500"));
    await buildWeatherStatus([weather("rainy", 13)], [], config);
    await buildWeatherStatus([weather("unavailable")], [], config);

    callServiceWithResponse.mockResolvedValueOnce(forecastResponse(15));
    const back = await buildWeatherStatus([weather("sunny", 14)], [], config);
    expect(callServiceWithResponse).toHaveBeenCalledTimes(2);
    expect(back).toMatchObject({ high: 15, temperature: 14 });
  });
});
