import { describe, expect, it } from "vitest";
import { meterRestoreActions } from "./power-meter-guard";
import type { AlwaysOnMeter } from "./config-schema";
import type { HaState } from "./types";

const METERS: AlwaysOnMeter[] = [
  {
    id: "washing_machine",
    label: "Washing Machine",
    switchEntityIds: ["switch.washing_machine", "switch.tuya_mobile_washing_machine"],
  },
  {
    id: "floating_meter",
    label: "Floating Meter",
    switchEntityIds: ["switch.tuya_mobile_floating_meter"],
  },
];

function statesOf(entries: Record<string, string>) {
  return new Map<string, HaState>(
    Object.entries(entries).map(([entity_id, state]) => [entity_id, { entity_id, state, attributes: {} }]),
  );
}

describe("meterRestoreActions", () => {
  it("restores a meter that is off", () => {
    const actions = meterRestoreActions(
      METERS,
      statesOf({ "switch.washing_machine": "off", "switch.tuya_mobile_floating_meter": "on" }),
    );

    expect(actions).toEqual([{ entityId: "switch.washing_machine", meterId: "washing_machine" }]);
  });

  it("leaves a meter that is on alone", () => {
    const actions = meterRestoreActions(
      METERS,
      statesOf({ "switch.washing_machine": "on", "switch.tuya_mobile_floating_meter": "on" }),
    );

    expect(actions).toEqual([]);
  });

  it("does not call a service for an unavailable or unknown meter", () => {
    // Off-network is not off. A service call cannot reach the plug, so firing
    // one would only produce log noise once a minute forever.
    const actions = meterRestoreActions(
      METERS,
      statesOf({
        "switch.washing_machine": "unavailable",
        "switch.tuya_mobile_floating_meter": "unknown",
      }),
    );

    expect(actions).toEqual([]);
  });

  it("ignores an entity Home Assistant does not have", () => {
    expect(meterRestoreActions(METERS, statesOf({}))).toEqual([]);
  });

  it("restores every known twin that reads off", () => {
    // A Tuya device answers on its LAN id or its cloud twin depending on what
    // is reachable; whichever ids are present and off get restored.
    const actions = meterRestoreActions(
      METERS,
      statesOf({
        "switch.washing_machine": "off",
        "switch.tuya_mobile_washing_machine": "off",
      }),
    );

    expect(actions.map((action) => action.entityId)).toEqual([
      "switch.washing_machine",
      "switch.tuya_mobile_washing_machine",
    ]);
  });

  it("does nothing when no meters are configured", () => {
    expect(meterRestoreActions([], statesOf({ "switch.washing_machine": "off" }))).toEqual([]);
  });
});
