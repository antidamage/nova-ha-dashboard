import assert from "node:assert/strict";
import test from "node:test";
import { buildAirconAutoActions, planAirconAutoTick, type AirconAutoState, type EntityActionInput } from "./aircon-control";
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

test("dashboard auto heats when the room is below the aircon target", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 22, temperature: 23 } }),
    preferences: { autoMode: true, temperature: 19 },
  });

  assert.deepEqual(
    plan.actions.map((action) => action.service).slice(0, 3),
    ["turn_on", "set_hvac_mode", "set_temperature"],
  );
  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "heat");
  assert.deepEqual(actionFor(plan.actions, "set_temperature")?.data, { hvac_mode: "heat", temperature: 23 });
  assert.equal(plan.nextState.lastTargetTemperature, 23);
});

test("dashboard auto cools when the room is above the aircon target", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 25,
    entity: climateEntity({ state: "heat", attributes: { current_temperature: 25, temperature: 23 } }),
    preferences: { autoMode: true, temperature: 19 },
  });

  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "cool");
  assert.deepEqual(actionFor(plan.actions, "set_temperature")?.data, { hvac_mode: "cool", temperature: 23 });
});

test("aircon target changes wake dashboard auto even when the slow sensor has not updated", () => {
  const tailedOffAt22: AirconAutoState = {
    enteredBandAt: null,
    lastSensorTemperature: 22,
    lastTargetTemperature: 22,
    tailedOff: true,
  };

  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 22, temperature: 24 } }),
    preferences: { autoMode: true, temperature: 22 },
    state: tailedOffAt22,
  });

  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "heat");
  assert.deepEqual(actionFor(plan.actions, "set_temperature")?.data, { hvac_mode: "heat", temperature: 24 });
  assert.equal(plan.nextState.tailedOff, false);
  assert.equal(plan.nextState.lastTargetTemperature, 24);
});

test("dashboard auto stays quiet after tail-off when neither aircon target nor sensor changed", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 22, temperature: 22 } }),
    preferences: { autoMode: true, temperature: 24 },
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

test("dashboard auto uses the air conditioner target over stale Nova preferences", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 22, temperature: 25 } }),
    preferences: { autoMode: true, temperature: 19, hvacMode: "cool" },
  });

  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "heat");
  assert.deepEqual(actionFor(plan.actions, "set_temperature")?.data, { hvac_mode: "heat", temperature: 25 });
  assert.equal(plan.nextState.lastTargetTemperature, 25);
});

test("changing the aircon target wakes an off unit when the new setpoint needs work", () => {
  // Mirrors ClimateControls.setTemperature in auto: the unit is off (auto cut it
  // off at the old target) and the dashboard still shows it active. The component
  // overrides the entity's target attribute with the user's new setpoint before
  // planning, so a colder target than the room now produces a turn_on.
  const actions = buildAirconAutoActions({
    currentTemperature: 21,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 21, temperature: 24 } }),
    forceRemember: true,
    preferences: { autoMode: true, temperature: 24 },
  });

  assert.equal(actionFor(actions, "turn_on")?.service, "turn_on");
  assert.equal(actionFor(actions, "set_hvac_mode")?.data?.hvac_mode, "heat");
});

test("auto leaves an already-off unit off when the room is at target", () => {
  const actions = buildAirconAutoActions({
    currentTemperature: 22,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 22, temperature: 22 } }),
    forceRemember: true,
    preferences: { autoMode: true, temperature: 22 },
  });

  // Homeostasis = off. The unit is already off, so the idempotent off path emits
  // no commands (the autoMode preference is persisted by the caller's fallback).
  assert.deepEqual(actions, []);
});

test("auto switches a running unit off once the room reaches target", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "heat", attributes: { current_temperature: 22, temperature: 22, fan_mode: "high" } }),
    preferences: { autoMode: true, temperature: 22 },
  });

  // Reaching target turns the unit off; the remembered preference keeps
  // autoMode:true so the dashboard still reads "Auto" while it rests.
  assert.equal(actionFor(plan.actions, "turn_off")?.service, "turn_off");
  assert.equal(actionFor(plan.actions, "turn_off")?.remember?.aircon?.autoMode, true);
  assert.equal(actionFor(plan.actions, "set_hvac_mode"), undefined);
  assert.equal(plan.nextState.tailedOff, true);
});

test("auto stops re-issuing off commands once the unit is already off", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 22, temperature: 22 } }),
    preferences: { autoMode: true, temperature: 22 },
  });

  assert.deepEqual(plan.actions, []);
  assert.equal(plan.nextState.tailedOff, true);
});

test("dashboard auto does not inherit an externally selected aircon mode", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 25,
    entity: climateEntity({ state: "heat", attributes: { current_temperature: 25, temperature: 23 } }),
    preferences: { autoMode: true },
  });

  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "cool");
  assert.deepEqual(actionFor(plan.actions, "set_temperature")?.data, { hvac_mode: "cool", temperature: 23 });
});
