import { describe, expect, it } from "vitest";
import { applyLoungeAirconTemperatureOverride } from "./ha";
import type { DashboardEntity } from "./types";

const TEMPERATURE_SENSOR_IDS = [
  "sensor.tuya_mobile_lounge_sensor_temperature",
  "sensor.wifi_temperature_humidity_sensor_temperature",
  "sensor.lounge_temperature",
];

function entity(partial: Partial<DashboardEntity> & Pick<DashboardEntity, "entity_id" | "domain" | "state">): DashboardEntity {
  return {
    name: partial.name ?? partial.entity_id,
    area_id: "lounge",
    attributes: {},
    ...partial,
  } as DashboardEntity;
}

function aircon(currentTemperature: number) {
  return entity({
    entity_id: "climate.c6780cad",
    domain: "climate",
    state: "off",
    name: "Air Conditioner",
    attributes: { current_temperature: currentTemperature, temperature: 21 },
  });
}

function tuya(value: string) {
  return entity({
    entity_id: "sensor.tuya_mobile_lounge_sensor_temperature",
    domain: "sensor",
    state: value,
    attributes: { device_class: "temperature" },
  });
}

describe("applyLoungeAirconTemperatureOverride", () => {
  it("replaces the Gree aircon current_temperature with the Tuya sensor reading", () => {
    const entities = [aircon(24), tuya("21.3")];
    applyLoungeAirconTemperatureOverride(entities, TEMPERATURE_SENSOR_IDS);

    expect(entities[0].attributes.current_temperature).toBe(21.3);
    // target temperature (a command echo) is untouched
    expect(entities[0].attributes.temperature).toBe(21);
  });

  it("prefers the Tuya sensor over later fallbacks and skips non-numeric readings", () => {
    const entities = [
      aircon(24),
      entity({
        entity_id: "sensor.wifi_temperature_humidity_sensor_temperature",
        domain: "sensor",
        state: "unavailable",
        attributes: { device_class: "temperature" },
      }),
      tuya("20.8"),
    ];
    applyLoungeAirconTemperatureOverride(entities, TEMPERATURE_SENSOR_IDS);

    expect(entities[0].attributes.current_temperature).toBe(20.8);
  });

  it("falls back to the next sensor when the Tuya reading is unavailable", () => {
    const entities = [
      aircon(24),
      tuya("unavailable"),
      entity({
        entity_id: "sensor.lounge_temperature",
        domain: "sensor",
        state: "21.0",
        attributes: { device_class: "temperature" },
      }),
    ];
    applyLoungeAirconTemperatureOverride(entities, TEMPERATURE_SENSOR_IDS);

    expect(entities[0].attributes.current_temperature).toBe(21);
  });

  it("leaves the panel heater (another room, working sensor) untouched", () => {
    const heater = entity({
      entity_id: "climate.panel_heater",
      domain: "climate",
      state: "off",
      name: "Panel Heater",
      attributes: { current_temperature: 20, temperature: 21 },
    });
    const entities = [aircon(24), heater, tuya("21.3")];
    applyLoungeAirconTemperatureOverride(entities, TEMPERATURE_SENSOR_IDS);

    expect(heater.attributes.current_temperature).toBe(20);
    expect(entities[0].attributes.current_temperature).toBe(21.3);
  });

  it("leaves the aircon unchanged when no lounge temperature sensor is available", () => {
    const entities = [aircon(24)];
    applyLoungeAirconTemperatureOverride(entities, TEMPERATURE_SENSOR_IDS);

    expect(entities[0].attributes.current_temperature).toBe(24);
  });
});
