import { describe, expect, it } from "vitest";
import {
  airconInstances,
  climateInstancesForZone,
  heaterInstances,
  LEGACY_AIRCON_INSTANCE_ID,
  LEGACY_HEATER_INSTANCE_ID,
} from "./climate-instances";
import type { DashboardConfig } from "./config-schema";

function config(dashboard: Partial<DashboardConfig["dashboard"]>): DashboardConfig {
  return {
    dashboard: {
      aircon: { offTimerIncrementMinutes: 10, matchTokens: [], title: "Climate" },
      bedroomHeater: {
        switchEntityIds: [],
        temperatureEntityIds: [],
        humidityEntityIds: [],
        title: "Heater",
      },
      climate: { airconUnits: [], heaters: [] },
      ...dashboard,
    },
  } as unknown as DashboardConfig;
}

describe("climate instances", () => {
  it("gives a fresh install no heater, so no empty card is rendered", () => {
    expect(heaterInstances(config({}))).toEqual([]);
  });

  it("derives one heater from the legacy block when a home has not declared instances", () => {
    const instances = heaterInstances(
      config({
        bedroomHeater: {
          switchEntityIds: ["switch.study_heater"],
          temperatureEntityIds: ["sensor.study_temperature"],
          humidityEntityIds: [],
          title: "Study",
        },
      } as Partial<DashboardConfig["dashboard"]>),
    );

    expect(instances).toHaveLength(1);
    expect(instances[0].title).toBe("Study");
    // The id must stay the historical key, or an upgrade loses the room's
    // remembered settings and its Nova/external ownership.
    expect(instances[0].id).toBe(LEGACY_HEATER_INSTANCE_ID);
  });

  it("keeps the legacy aircon id for the same reason", () => {
    const instances = airconInstances(config({}));
    expect(instances).toHaveLength(1);
    expect(instances[0].id).toBe(LEGACY_AIRCON_INSTANCE_ID);
  });

  it("uses declared instances instead of the legacy blocks once a home has them", () => {
    const cfg = config({
      climate: {
        airconUnits: [
          { id: "study", title: "Study", zoneId: "study", matchTokens: [] },
          { id: "garage", title: "Garage", zoneId: "garage", matchTokens: ["heat pump"] },
        ],
        heaters: [
          {
            id: "garage_heater",
            title: "Garage",
            zoneId: "garage",
            switchEntityIds: ["switch.garage_heater"],
            temperatureEntityIds: ["sensor.garage_temperature"],
            humidityEntityIds: [],
          },
        ],
      },
      bedroomHeater: {
        switchEntityIds: ["switch.ignored_legacy"],
        temperatureEntityIds: [],
        humidityEntityIds: [],
        title: "Ignored",
      },
    } as Partial<DashboardConfig["dashboard"]>);

    expect(airconInstances(cfg).map((unit) => unit.id)).toEqual(["study", "garage"]);
    expect(heaterInstances(cfg).map((heater) => heater.id)).toEqual(["garage_heater"]);
  });

  it("finds the instances serving a zone, which is how a control reaches its own room", () => {
    const cfg = config({
      climate: {
        airconUnits: [{ id: "study", title: "Study", zoneId: "study", matchTokens: [] }],
        heaters: [
          {
            id: "garage_heater",
            title: "Garage",
            zoneId: "Garage",
            switchEntityIds: ["switch.garage_heater"],
            temperatureEntityIds: [],
            humidityEntityIds: [],
          },
        ],
      },
    } as Partial<DashboardConfig["dashboard"]>);

    expect(climateInstancesForZone(cfg, "study").map((i) => i.id)).toEqual(["study"]);
    // Case-insensitive: a zone id and an area name are not always spelled alike.
    expect(climateInstancesForZone(cfg, "garage").map((i) => i.id)).toEqual(["garage_heater"]);
    expect(climateInstancesForZone(cfg, "kitchen")).toEqual([]);
  });

  it("leaves an instance out of every zone when it declares none", () => {
    const cfg = config({
      climate: {
        airconUnits: [{ id: "study", title: "Study", matchTokens: [] }],
        heaters: [],
      },
    } as Partial<DashboardConfig["dashboard"]>);

    expect(climateInstancesForZone(cfg, "study")).toEqual([]);
  });
});
