import { describe, expect, it } from "vitest";
import { dedupeCloudTwins } from "./twins";
import type { DashboardEntity } from "../types";
import type { RegistrySnapshot } from "./registry";

const DEV_ID = "ebdab3cb40963c2fb2smsz";

/**
 * Which identifier prefixes mark a cloud twin is config, not a constant in the
 * product — it names whichever bridge a home runs. This is fixture data; the
 * behaviour under test is the pairing, not the prefix.
 */
const CLOUD_PREFIXES = ["tuya_mobile_"];

function snapshot(devices: RegistrySnapshot["devices"]): RegistrySnapshot {
  return { areas: [], devices, entities: [], labels: [], warnings: [] };
}

function twinDevices(): RegistrySnapshot["devices"] {
  return [
    { id: "local-dev", identifiers: [["tuya_local", DEV_ID]] },
    { id: "cloud-dev", identifiers: [["mqtt", `tuya_mobile_${DEV_ID}`]] },
  ];
}

function entity(overrides: Partial<DashboardEntity>): DashboardEntity {
  return {
    entity_id: "light.example",
    domain: "light",
    state: "on",
    name: "Example",
    area_id: "lounge",
    attributes: {},
    ...overrides,
  };
}

describe("dedupeCloudTwins", () => {
  it("hides the cloud twin while the LAN entity is usable", () => {
    const entities = [
      entity({ entity_id: "light.cupboard_socket_1", state: "off", device_id: "local-dev" }),
      entity({ entity_id: "light.tuya_mobile_neon_lights", state: "off", device_id: "cloud-dev" }),
    ];
    const result = dedupeCloudTwins(entities, snapshot(twinDevices()), CLOUD_PREFIXES);
    expect(result.map((e) => e.entity_id)).toEqual(["light.cupboard_socket_1"]);
  });

  it("falls back to the cloud twin when the LAN entity is unavailable", () => {
    const entities = [
      entity({ entity_id: "light.cupboard_socket_1", state: "unavailable", device_id: "local-dev" }),
      entity({ entity_id: "light.tuya_mobile_neon_lights", state: "off", device_id: "cloud-dev" }),
    ];
    const result = dedupeCloudTwins(entities, snapshot(twinDevices()), CLOUD_PREFIXES);
    expect(result.map((e) => e.entity_id)).toEqual(["light.tuya_mobile_neon_lights"]);
  });

  it("keeps a single local tile when both halves are dead", () => {
    const entities = [
      entity({ entity_id: "light.cupboard_socket_1", state: "unavailable", device_id: "local-dev" }),
      entity({ entity_id: "light.tuya_mobile_neon_lights", state: "unavailable", device_id: "cloud-dev" }),
    ];
    const result = dedupeCloudTwins(entities, snapshot(twinDevices()), CLOUD_PREFIXES);
    expect(result.map((e) => e.entity_id)).toEqual(["light.cupboard_socket_1"]);
  });

  it("dedupes per domain: dead local climate falls over while its sensors stay", () => {
    const entities = [
      entity({
        entity_id: "climate.panel_heater_2",
        domain: "climate",
        state: "unavailable",
        device_id: "local-dev",
      }),
      entity({
        entity_id: "sensor.cupboard_power_2",
        domain: "sensor",
        state: "12.5",
        device_id: "local-dev",
      }),
      entity({
        entity_id: "climate.tuya_mobile_panel_heater",
        domain: "climate",
        state: "heat",
        device_id: "cloud-dev",
      }),
    ];
    const result = dedupeCloudTwins(entities, snapshot(twinDevices()), CLOUD_PREFIXES);
    expect(result.map((e) => e.entity_id)).toEqual([
      "sensor.cupboard_power_2",
      "climate.tuya_mobile_panel_heater",
    ]);
  });

  it("leaves cloud-only devices and unpaired entities untouched", () => {
    const devices: RegistrySnapshot["devices"] = [
      { id: "cloud-dev", identifiers: [["mqtt", "tuya_mobile_7463034340f520c1cf42"]] },
      { id: "other-dev" },
    ];
    const entities = [
      entity({ entity_id: "light.tuya_mobile_kitchen_light_2", state: "on", device_id: "cloud-dev" }),
      entity({ entity_id: "light.desk", state: "on", device_id: "other-dev" }),
      entity({ entity_id: "light.no_device", state: "on", device_id: undefined }),
    ];
    const result = dedupeCloudTwins(entities, snapshot(devices), CLOUD_PREFIXES);
    expect(result).toHaveLength(3);
  });

  it("keeps local switches that have no cloud counterpart during fallback", () => {
    const entities = [
      entity({ entity_id: "light.cupboard_socket_1", state: "unavailable", device_id: "local-dev" }),
      entity({
        entity_id: "switch.cupboard_outlet_2",
        domain: "switch",
        state: "unavailable",
        device_id: "local-dev",
      }),
      entity({ entity_id: "light.tuya_mobile_neon_lights", state: "off", device_id: "cloud-dev" }),
    ];
    const result = dedupeCloudTwins(entities, snapshot(twinDevices()), CLOUD_PREFIXES);
    expect(result.map((e) => e.entity_id)).toEqual([
      "switch.cupboard_outlet_2",
      "light.tuya_mobile_neon_lights",
    ]);
  });
});
