import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const applyClimateControlIntent = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../dashboard-config", () => ({ readDashboardConfig: vi.fn(async () => config.current) }));
vi.mock("../../climate-control", () => ({ applyClimateControlIntent }));

const { climateArrivalTarget } = await import("./climate");

function configWithClimate(airconUnits: unknown[]) {
  return {
    dashboard: {
      aircon: { matchTokens: [], offTimerIncrementMinutes: 30, title: "Climate" },
      bedroomHeater: { switchEntityIds: [], temperatureEntityIds: [], humidityEntityIds: [], title: "Heater" },
      climate: { airconUnits, heaters: [] },
      arrivals: {
        climatePresets: [
          { id: "lounge-off", label: "Lounge off", instanceId: "lounge", mode: "off" },
          { id: "lounge-cool", label: "Lounge cool", instanceId: "lounge", mode: "manual", direction: "cool", temperature: 21 },
        ],
        volumePresets: [],
      },
    },
  };
}

beforeEach(() => {
  applyClimateControlIntent.mockClear();
  config.current = configWithClimate([{ id: "lounge", title: "Lounge" }]);
});

describe("air conditioning arrival target", () => {
  it("lists the configured presets", async () => {
    expect(await climateArrivalTarget.presets()).toEqual([
      { id: "lounge-off", label: "Lounge off" },
      { id: "lounge-cool", label: "Lounge cool" },
    ]);
  });

  it("applies a preset as a climate-control intent", async () => {
    await climateArrivalTarget.apply("lounge-cool");

    expect(applyClimateControlIntent).toHaveBeenCalledWith({
      room: "lounge",
      mode: "manual",
      direction: "cool",
      temperature: 21,
    });
  });

  it("offers nothing when no preset is configured", async () => {
    config.current = {
      dashboard: {
        ...(config.current.dashboard as Record<string, unknown>),
        arrivals: { climatePresets: [], volumePresets: [] },
      },
    };

    expect(await climateArrivalTarget.presets()).toEqual([]);
  });

  it("refuses a preset that is not configured", async () => {
    await expect(climateArrivalTarget.apply("nope")).rejects.toThrow("Unknown air-conditioning preset: nope");
    expect(applyClimateControlIntent).not.toHaveBeenCalled();
  });

  it("refuses a preset naming a climate device this house does not have", async () => {
    config.current = configWithClimate([{ id: "office", title: "Office" }]);

    await expect(climateArrivalTarget.apply("lounge-off"))
      .rejects.toThrow('Preset "Lounge off" names a climate device that is not configured: lounge');
    expect(applyClimateControlIntent).not.toHaveBeenCalled();
  });
});
