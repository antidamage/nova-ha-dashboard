import assert from "node:assert/strict";
import test from "node:test";
import { planAirconAutoTick, type AirconAutoState, type EntityActionInput } from "./aircon-control";
import type { DashboardEntity } from "./types";

function climateEntity(overrides: Partial<DashboardEntity> = {}): DashboardEntity {
  const attributes = {
    current_temperature: 22,
    fan_mode: "medium",
    hvac_modes: ["auto", "cool", "dry", "fan_only", "heat", "off"],
    max_temp: 30,
    min_temp: 8,
    temperature: 23,
    ...(overrides.attributes ?? {}),
  };
  const { attributes: _attributes, ...entityOverrides } = overrides;

  return {
    area_id: "climate",
    attributes,
    domain: "climate",
    entity_id: "climate.c6780cad",
    name: "Air Conditioner",
    state: "off",
    ...entityOverrides,
  };
}

function actionFor(actions: EntityActionInput[], service: string) {
  return actions.find((action) => action.service === service);
}

test("dashboard auto heats when the room is below the selected target", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 22, temperature: 23 } }),
    preferences: { autoMode: true, temperature: 23 },
  });

  assert.deepEqual(
    plan.actions.map((action) => action.service).slice(0, 3),
    ["turn_on", "set_hvac_mode", "set_temperature"],
  );
  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "heat");
  assert.deepEqual(actionFor(plan.actions, "set_temperature")?.data, { hvac_mode: "heat", temperature: 23 });
  assert.equal(plan.nextState.lastTargetTemperature, 23);
});

test("dashboard auto cools when the room is above the selected target", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 25,
    entity: climateEntity({ state: "heat", attributes: { current_temperature: 25, temperature: 23 } }),
    preferences: { autoMode: true, temperature: 23 },
  });

  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "cool");
  assert.deepEqual(actionFor(plan.actions, "set_temperature")?.data, { hvac_mode: "cool", temperature: 23 });
});

test("target changes wake dashboard auto even when the slow sensor has not updated", () => {
  const tailedOffAt22: AirconAutoState = {
    enteredBandAt: null,
    lastSensorTemperature: 22,
    lastTargetTemperature: 22,
    tailedOff: true,
  };

  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 22, temperature: 22 } }),
    preferences: { autoMode: true, temperature: 24 },
    state: tailedOffAt22,
  });

  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "heat");
  assert.deepEqual(actionFor(plan.actions, "set_temperature")?.data, { hvac_mode: "heat", temperature: 24 });
  assert.equal(plan.nextState.tailedOff, false);
  assert.equal(plan.nextState.lastTargetTemperature, 24);
});

test("dashboard auto stays quiet after tail-off when neither target nor sensor changed", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 22, temperature: 22 } }),
    preferences: { autoMode: true, temperature: 22 },
    state: {
      enteredBandAt: null,
      lastSensorTemperature: 22,
      lastTargetTemperature: 22,
      tailedOff: true,
    },
  });

  assert.deepEqual(plan.actions, []);
  assert.equal(plan.nextState.tailedOff, true);
});
