import assert from "node:assert/strict";
import test from "node:test";
import {
  AIRCON_INTENT_MARGIN_DEGREES,
  AirconAutoThermostat,
  airconAutoCycleStateFromPreferences,
  airconAutoMeasuredTemperature,
  airconUserModeIntent,
  buildAirconAutoActions,
  dashboardAirconEntity,
  planAirconAutoTick,
  type AirconAutoState,
  type EntityActionInput,
} from "./aircon-control";
import type { DashboardEntity } from "./types";

/*
 * Time is passed in explicitly, as `now`, exactly as bedroom-heater-control.test.ts
 * does. There are no fake timers here and there must not be: the guards under
 * test are 10 and 30 minutes long, and a suite that reached for real clocks
 * could not assert either edge.
 */
const NOW = 1_000_000_000;
const MINUTE = 60_000;

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

/** A unit resting off, having last driven `mode` at `modeAt`. */
function restingState(overrides: Partial<AirconAutoState> = {}): AirconAutoState {
  return {
    lastMode: null,
    lastModeAt: null,
    lastTransitionAt: null,
    recentStartsAt: [],
    lastTargetTemperature: null,
    ...overrides,
  };
}

function actionFor(actions: EntityActionInput[], service: string) {
  return actions.find((action) => action.service === service);
}

test("Auto accepts only a fresh Gree temperature report", () => {
  const fresh = climateEntity({
    state: "heat",
    last_reported: new Date(NOW - 29 * MINUTE).toISOString(),
  });
  const stale = climateEntity({
    state: "heat",
    last_reported: new Date(NOW - 30 * MINUTE - 1).toISOString(),
  });

  assert.equal(airconAutoMeasuredTemperature(fresh, NOW), 22);
  assert.equal(airconAutoMeasuredTemperature(stale, NOW), null);
  assert.equal(
    airconAutoMeasuredTemperature(
      climateEntity({
        state: "heat",
        attributes: { current_temperature: null },
        last_reported: new Date(NOW - MINUTE).toISOString(),
      }),
      NOW,
    ),
    null,
  );
  assert.equal(airconAutoMeasuredTemperature(climateEntity({ state: "unavailable" }), NOW), null);
});

test("the shared aircon selector cannot mistake a panel heater for Auto's input", () => {
  const panel = climateEntity({ entity_id: "climate.panel_heater", attributes: { friendly_name: "Panel Heater" } });
  const gree = climateEntity({ entity_id: "climate.gree_lounge", attributes: { friendly_name: "Gree Air Conditioner" } });
  assert.equal(dashboardAirconEntity([panel, gree])?.entity_id, gree.entity_id);
  assert.equal(dashboardAirconEntity([panel]), undefined);
});

test("missing temperature input forces the air conditioner off and clears Auto", () => {
  const plan = planAirconAutoTick({
    currentTemperature: null,
    entity: climateEntity({ state: "heat" }),
    now: NOW,
    preferences: { autoMode: true, temperature: 22 },
  });

  assert.equal(plan.reason, "sensor-fail-safe-off");
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0]?.service, "turn_off");
  assert.equal(plan.actions[0]?.remember?.aircon?.autoMode, false);
  assert.equal(plan.actions[0]?.remember?.aircon?.offTimerEndsAt, null);
});

test("dashboard auto heats when the room is well below the aircon target", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 20,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 20, temperature: 23 } }),
    now: NOW,
    preferences: { autoMode: true, temperature: 19 },
  });

  assert.equal(plan.reason, "driving");
  assert.equal(plan.wantedMode, "heat");
  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "heat");
  assert.deepEqual(actionFor(plan.actions, "set_temperature")?.data, { hvac_mode: "heat", temperature: 23 });
  assert.equal(plan.nextState.lastTargetTemperature, 23);
});

test("dashboard auto cools when the room is well above the aircon target", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 26,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 26, temperature: 23 } }),
    now: NOW,
    preferences: { autoMode: true, temperature: 19 },
  });

  assert.equal(plan.wantedMode, "cool");
  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "cool");
  assert.deepEqual(actionFor(plan.actions, "set_temperature")?.data, { hvac_mode: "cool", temperature: 23 });
});

test("a mode change goes out on its own, without a turn_on ahead of it", () => {
  // turn_on lands the unit in its PREVIOUS mode for a moment, which is how the
  // 2026-08-09 logbook came to show turn_on -> heat immediately followed by
  // set_hvac_mode -> cool. set_hvac_mode powers the unit on by itself.
  const plan = planAirconAutoTick({
    currentTemperature: 26,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 26, temperature: 23 } }),
    now: NOW,
    preferences: { autoMode: true },
  });

  assert.equal(actionFor(plan.actions, "turn_on"), undefined);
  assert.equal(plan.actions[0]?.service, "set_hvac_mode");
});

// ---------------------------------------------------------------------------
// Resting band: off AT target, resume AIRCON_AUTO_RESUME_DEGREES past it.
// ---------------------------------------------------------------------------

test("auto switches a running unit off the moment the reading reaches target", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "heat", attributes: { current_temperature: 22, temperature: 22, fan_mode: "high" } }),
    now: NOW,
    preferences: { autoMode: true, temperature: 22 },
  });

  assert.equal(plan.reason, "reached-target");
  assert.equal(actionFor(plan.actions, "turn_off")?.service, "turn_off");
  assert.equal(actionFor(plan.actions, "turn_off")?.remember?.aircon?.autoMode, true);
  assert.equal(actionFor(plan.actions, "set_hvac_mode"), undefined);
});

test("a resting unit stays resting two degrees off target", () => {
  // The whole failure being guarded against: the Gree's thermistor moves this far
  // on its own the second the fan stops. Two degrees is not a reason to start a
  // compressor.
  const plan = planAirconAutoTick({
    currentTemperature: 20,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 20, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({ lastTargetTemperature: 22 }),
  });

  assert.equal(plan.reason, "resting");
  assert.deepEqual(plan.actions, []);
});

test("a resting unit resumes three degrees off target", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 19,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 19, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({ lastTargetTemperature: 22 }),
  });

  assert.equal(plan.reason, "driving");
  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "heat");
});

test("a unit already driving keeps going short of target rather than resting", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 21,
    entity: climateEntity({ state: "heat", attributes: { current_temperature: 21, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({ lastMode: "heat", lastModeAt: NOW - MINUTE, lastTransitionAt: NOW - MINUTE, lastTargetTemperature: 22 }),
  });

  // One degree short of target is inside the resume band but the unit is already
  // running: the hysteresis is asymmetric, so it runs on to target.
  assert.equal(plan.reason, "driving");
  assert.equal(actionFor(plan.actions, "turn_off"), undefined);
});

test("a target the user moved reopens a resting cycle inside the resume band", () => {
  // Otherwise asking for two degrees warmer does nothing at all until the room
  // drifts three degrees, which reads as a dead control.
  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 22, temperature: 24 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({ lastTargetTemperature: 22 }),
  });

  assert.equal(plan.reason, "driving");
  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "heat");
  assert.deepEqual(actionFor(plan.actions, "set_temperature")?.data, { hvac_mode: "heat", temperature: 24 });
});

test("a fresh state is not mistaken for a target the user moved", () => {
  // lastTargetTemperature is null after a reload. That must read as "unknown",
  // not as a change, or every page load would bypass the resume band.
  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 22, temperature: 24 } }),
    now: NOW,
    preferences: { autoMode: true },
  });

  assert.equal(plan.reason, "resting");
  assert.deepEqual(plan.actions, []);
});

test("auto stops re-issuing off commands once the unit is already off", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 22, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true, temperature: 22 },
  });

  assert.deepEqual(plan.actions, []);
});

// ---------------------------------------------------------------------------
// The flip-flop guard.
// ---------------------------------------------------------------------------

test("auto refuses to reverse direction inside the 30-minute hold", () => {
  // The exact 2026-08-09 shape: heating, reached target, the thermistor heat-soaks
  // several degrees while the fan is stopped, and the old planner read that as
  // "cool the room" seven seconds later. In mid-winter.
  const plan = planAirconAutoTick({
    currentTemperature: 26,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 26, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({
      lastMode: "heat",
      lastModeAt: NOW - 5 * MINUTE,
      lastTransitionAt: NOW - 5 * MINUTE,
      lastTargetTemperature: 22,
    }),
  });

  assert.equal(plan.reason, "mode-hold");
  assert.equal(plan.wantedMode, "cool");
  assert.deepEqual(plan.actions, []);
});

test("auto reverses direction once the 30-minute hold has run out", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 26,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 26, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({
      lastMode: "heat",
      lastModeAt: NOW - (30 * MINUTE + 1),
      lastTransitionAt: NOW - (30 * MINUTE + 1),
      lastTargetTemperature: 22,
    }),
  });

  assert.equal(plan.reason, "driving");
  assert.equal(plan.wantedMode, "cool");
  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "cool");
  assert.equal(plan.nextState.lastMode, "cool");
  assert.equal(plan.nextState.lastModeAt, NOW);
});

test("being blocked by the hold does not extend the hold", () => {
  // If a blocked tick restamped lastModeAt, a persistently wrong reading would
  // freeze the direction forever instead of for half an hour.
  const state = restingState({
    lastMode: "heat",
    lastModeAt: NOW - 20 * MINUTE,
    lastTransitionAt: NOW - 20 * MINUTE,
    lastTargetTemperature: 22,
  });
  const entity = climateEntity({ state: "off", attributes: { current_temperature: 26, temperature: 22 } });

  const first = planAirconAutoTick({ currentTemperature: 26, entity, now: NOW, state });
  const second = planAirconAutoTick({
    currentTemperature: 26,
    entity,
    now: NOW + MINUTE,
    state: first.nextState,
  });

  assert.equal(second.reason, "mode-hold");
  assert.equal(second.nextState.lastModeAt, NOW - 20 * MINUTE);
});

test("continuing in the same direction is never blocked by the hold", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 18,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 18, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({
      lastMode: "heat",
      lastModeAt: NOW - MINUTE,
      lastTransitionAt: NOW - 30 * MINUTE,
      lastTargetTemperature: 22,
    }),
  });

  assert.equal(plan.reason, "driving");
  assert.equal(plan.wantedMode, "heat");
});

// ---------------------------------------------------------------------------
// Minimum cycle dwell and the hourly start cap.
// ---------------------------------------------------------------------------

test("auto will not restart the compressor inside the minimum cycle", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 18,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 18, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({ lastTransitionAt: NOW - 5 * MINUTE, lastTargetTemperature: 22 }),
  });

  assert.equal(plan.reason, "min-cycle-hold");
  assert.deepEqual(plan.actions, []);
});

test("auto restarts the compressor once the minimum cycle has elapsed", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 18,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 18, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({ lastTransitionAt: NOW - (10 * MINUTE + 1), lastTargetTemperature: 22 }),
  });

  assert.equal(plan.reason, "driving");
  assert.equal(plan.nextState.lastTransitionAt, NOW);
  assert.deepEqual(plan.nextState.recentStartsAt, [NOW]);
});

test("the minimum cycle never delays turning the unit OFF", () => {
  // A guard that could hold a turn_off would leave the unit driving the room the
  // wrong way for up to ten minutes. Stopping is always allowed.
  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "heat", attributes: { current_temperature: 22, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({ lastMode: "heat", lastModeAt: NOW - MINUTE, lastTransitionAt: NOW - MINUTE, lastTargetTemperature: 22 }),
  });

  assert.equal(plan.reason, "reached-target");
  assert.equal(actionFor(plan.actions, "turn_off")?.service, "turn_off");
});

test("the mode hold never delays turning the unit OFF either", () => {
  // Wanting cool while held to heat, with the unit running heat: it must stop,
  // not run on because a guard said no.
  const plan = planAirconAutoTick({
    currentTemperature: 26,
    entity: climateEntity({ state: "heat", attributes: { current_temperature: 26, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({ lastMode: "heat", lastModeAt: NOW - MINUTE, lastTransitionAt: NOW - MINUTE, lastTargetTemperature: 22 }),
  });

  assert.equal(actionFor(plan.actions, "turn_off")?.service, "turn_off");
  assert.equal(actionFor(plan.actions, "set_hvac_mode"), undefined);
});

test("auto stops after three compressor starts in an hour", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 18,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 18, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({
      lastMode: "heat",
      lastModeAt: NOW - 40 * MINUTE,
      lastTransitionAt: NOW - 11 * MINUTE,
      recentStartsAt: [NOW - 50 * MINUTE, NOW - 30 * MINUTE, NOW - 11 * MINUTE],
      lastTargetTemperature: 22,
    }),
  });

  assert.equal(plan.reason, "starts-per-hour-hold");
  assert.deepEqual(plan.actions, []);
});

test("the hourly start cap releases as the oldest start rolls out of the window", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 18,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 18, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({
      lastMode: "heat",
      lastModeAt: NOW - 90 * MINUTE,
      lastTransitionAt: NOW - 11 * MINUTE,
      recentStartsAt: [NOW - 61 * MINUTE, NOW - 30 * MINUTE, NOW - 11 * MINUTE],
      lastTargetTemperature: 22,
    }),
  });

  assert.equal(plan.reason, "driving");
  assert.deepEqual(plan.nextState.recentStartsAt, [NOW - 30 * MINUTE, NOW - 11 * MINUTE, NOW]);
});

test("being held off a start still stops a unit left in a mode auto never picks", () => {
  // fan_only/dry can only have come from someone else. The dwell is a reason not
  // to START the compressor, not a reason to leave the unit running.
  const plan = planAirconAutoTick({
    currentTemperature: 18,
    entity: climateEntity({ state: "fan_only", attributes: { current_temperature: 18, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({ lastTransitionAt: NOW - MINUTE, lastTargetTemperature: 22 }),
  });

  assert.equal(plan.reason, "min-cycle-hold");
  assert.equal(actionFor(plan.actions, "turn_off")?.service, "turn_off");
});

test("a fan step is not a compressor cycle", () => {
  // Driving on toward target restages the fan as the delta shrinks. That must not
  // stamp the dwell or count as a start, or the guards would never accumulate.
  const plan = planAirconAutoTick({
    currentTemperature: 19,
    entity: climateEntity({ state: "heat", attributes: { current_temperature: 19, temperature: 22, fan_mode: "low" } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({
      lastMode: "heat",
      lastModeAt: NOW - 5 * MINUTE,
      lastTransitionAt: NOW - 5 * MINUTE,
      recentStartsAt: [NOW - 5 * MINUTE],
      lastTargetTemperature: 22,
    }),
  });

  assert.equal(plan.reason, "driving");
  assert.equal(plan.nextState.lastTransitionAt, NOW - 5 * MINUTE);
  assert.deepEqual(plan.nextState.recentStartsAt, [NOW - 5 * MINUTE]);
});

// ---------------------------------------------------------------------------
// What a person is allowed to override.
// ---------------------------------------------------------------------------

test("any user setpoint change clears every behavioural lock and may reverse immediately", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 26,
    entity: climateEntity({ state: "heat", attributes: { current_temperature: 26, temperature: 20 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({
      lastMode: "heat",
      lastModeAt: NOW - MINUTE,
      lastTransitionAt: NOW - MINUTE,
      recentStartsAt: [NOW - 3 * MINUTE, NOW - 2 * MINUTE, NOW - MINUTE],
      lastTargetTemperature: 22,
    }),
  });

  assert.equal(plan.reason, "driving");
  assert.equal(plan.wantedMode, "cool");
  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "cool");
  assert.equal(plan.nextState.lastMode, "cool");
  assert.equal(plan.nextState.lastModeAt, NOW);
  assert.equal(plan.nextState.lastTransitionAt, NOW);
  assert.deepEqual(plan.nextState.recentStartsAt, [NOW]);
});

test("a setpoint past the room reading reads as asking for the other direction", () => {
  assert.equal(airconUserModeIntent(21, 24), "cool");
  assert.equal(airconUserModeIntent(27, 24), "heat");
});

test("a setpoint that only nudges the target reads as no direction at all", () => {
  // This is the distinction the whole rule turns on: a degree either side of the
  // room is a comfort tweak, not a request to reverse a heat pump.
  assert.equal(airconUserModeIntent(23, 24), undefined);
  assert.equal(airconUserModeIntent(25, 24), undefined);
  assert.equal(airconUserModeIntent(24 - AIRCON_INTENT_MARGIN_DEGREES, 24), undefined);
  assert.equal(airconUserModeIntent(24 + AIRCON_INTENT_MARGIN_DEGREES, 24), undefined);
});

test("intent needs a reading to be measured against", () => {
  assert.equal(airconUserModeIntent(18, null), undefined);
});

test("clearing lastModeAt is what lets the next tick reverse", () => {
  // The break itself is written by ClimateControls (it is the only place that can
  // tell a person from an echo); this is the planner half of that contract.
  const plan = planAirconAutoTick({
    currentTemperature: 26,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 26, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({ lastMode: "heat", lastModeAt: null, lastTransitionAt: null, lastTargetTemperature: 22 }),
  });

  assert.equal(plan.reason, "driving");
  assert.equal(plan.wantedMode, "cool");
});

test("pressing Auto acts immediately but still respects the compressor dwell", () => {
  const entity = climateEntity({ state: "off", attributes: { current_temperature: 22, temperature: 24 } });

  // forceRemember is the user-pressed-Auto path: it bypasses the resume band.
  const armed = buildAirconAutoActions({
    currentTemperature: 22,
    entity,
    forceRemember: true,
    now: NOW,
    preferences: { autoMode: true, temperature: 24 },
  });
  assert.equal(actionFor(armed, "set_hvac_mode")?.data?.hvac_mode, "heat");

  // ...but not the dwell. Pressing a button twice must not short-cycle a
  // compressor (bedroom heater, 2026-08-08).
  const heldByDwell = buildAirconAutoActions({
    currentTemperature: 22,
    entity,
    forceRemember: true,
    now: NOW,
    preferences: { autoMode: true, temperature: 24 },
    state: { lastTransitionAt: NOW - MINUTE },
  });
  assert.deepEqual(heldByDwell, []);
});

test("auto leaves an already-off unit off when the room is at target", () => {
  const actions = buildAirconAutoActions({
    currentTemperature: 22,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 22, temperature: 22 } }),
    forceRemember: true,
    now: NOW,
    preferences: { autoMode: true, temperature: 22 },
  });

  assert.deepEqual(actions, []);
});

test("dashboard auto uses the air conditioner target over stale Nova preferences", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 22, temperature: 25 } }),
    now: NOW,
    preferences: { autoMode: true, temperature: 19, hvacMode: "cool" },
  });

  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "heat");
  assert.deepEqual(actionFor(plan.actions, "set_temperature")?.data, { hvac_mode: "heat", temperature: 25 });
  assert.equal(plan.nextState.lastTargetTemperature, 25);
});

test("dashboard auto does not inherit an externally selected aircon mode", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 26,
    entity: climateEntity({ state: "fan_only", attributes: { current_temperature: 26, temperature: 23 } }),
    now: NOW,
    preferences: { autoMode: true },
  });

  assert.equal(actionFor(plan.actions, "set_hvac_mode")?.data?.hvac_mode, "cool");
  assert.deepEqual(actionFor(plan.actions, "set_temperature")?.data, { hvac_mode: "cool", temperature: 23 });
});

// ---------------------------------------------------------------------------
// The guards have to survive a reload, so they live in preferences too.
// ---------------------------------------------------------------------------

test("the cycle guards are carried on the remember payload of every transition", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 18,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 18, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({ lastTargetTemperature: 22 }),
  });

  const remembered = actionFor(plan.actions, "set_hvac_mode")?.remember?.aircon;
  assert.equal(remembered?.autoLastMode, "heat");
  assert.equal(remembered?.autoLastModeAt, NOW);
  assert.equal(remembered?.autoLastTransitionAt, NOW);
  assert.deepEqual(remembered?.autoRecentStartsAt, [NOW]);
});

test("a turn_off carries the guards too, so the dwell survives a reload", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 22,
    entity: climateEntity({ state: "heat", attributes: { current_temperature: 22, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: restingState({ lastMode: "heat", lastModeAt: NOW - MINUTE, lastTransitionAt: NOW - MINUTE, lastTargetTemperature: 22 }),
  });

  assert.equal(actionFor(plan.actions, "turn_off")?.remember?.aircon?.autoLastTransitionAt, NOW);
});

test("cycle state read back out of preferences round-trips", () => {
  const state = airconAutoCycleStateFromPreferences({
    autoLastMode: "cool",
    autoLastModeAt: NOW,
    autoLastTransitionAt: NOW - MINUTE,
    autoRecentStartsAt: [NOW - MINUTE],
  });

  assert.deepEqual(state, {
    lastMode: "cool",
    lastModeAt: NOW,
    lastTransitionAt: NOW - MINUTE,
    recentStartsAt: [NOW - MINUTE],
  });
});

test("a malformed start list reads as no starts rather than crashing the loop", () => {
  const plan = planAirconAutoTick({
    currentTemperature: 18,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 18, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
    state: { recentStartsAt: undefined as unknown as number[], lastTargetTemperature: 22 },
  });

  assert.equal(plan.reason, "driving");
});

test("resetForUserRequest keeps the guards that protect the compressor", () => {
  const thermostat = new AirconAutoThermostat();
  thermostat.plan({
    currentTemperature: 18,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 18, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
  });
  const driving = thermostat.snapshot();
  assert.equal(driving.lastTransitionAt, NOW);

  thermostat.resetForUserRequest();
  const after = thermostat.snapshot();
  assert.equal(after.lastTransitionAt, NOW);
  assert.equal(after.lastMode, "heat");
  assert.equal(after.lastModeAt, NOW);
  assert.deepEqual(after.recentStartsAt, [NOW]);
  // The per-cycle bookkeeping IS cleared, so a fresh request is not swallowed.
  assert.equal(after.lastTargetTemperature, null);
});

test("reset wipes everything, for auto being switched off entirely", () => {
  const thermostat = new AirconAutoThermostat();
  thermostat.plan({
    currentTemperature: 18,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 18, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
  });

  thermostat.reset();
  assert.deepEqual(thermostat.snapshot(), restingState());
});

test("reconcile takes whichever copy of the guards is further ahead", () => {
  const thermostat = new AirconAutoThermostat();
  thermostat.plan({
    currentTemperature: 18,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 18, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
  });

  // Another client reversed to cool more recently than this tab knows about.
  thermostat.reconcile({
    lastMode: "cool",
    lastModeAt: NOW + MINUTE,
    lastTransitionAt: NOW + MINUTE,
    recentStartsAt: [NOW, NOW + MINUTE],
  });

  const state = thermostat.snapshot();
  assert.equal(state.lastMode, "cool");
  assert.equal(state.lastModeAt, NOW + MINUTE);
  assert.equal(state.lastTransitionAt, NOW + MINUTE);
  assert.deepEqual(state.recentStartsAt.sort((a, b) => a - b), [NOW, NOW + MINUTE]);
});

test("reconcile does not let a stale durable copy walk the guards backwards", () => {
  const thermostat = new AirconAutoThermostat();
  thermostat.plan({
    currentTemperature: 18,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 18, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
  });

  thermostat.reconcile({
    lastMode: "cool",
    lastModeAt: NOW - 10 * MINUTE,
    lastTransitionAt: NOW - 10 * MINUTE,
    recentStartsAt: [],
  });

  const state = thermostat.snapshot();
  assert.equal(state.lastMode, "heat");
  assert.equal(state.lastModeAt, NOW);
  assert.equal(state.lastTransitionAt, NOW);
});

test("a fresh tab picks the guards up from preferences on its first tick", () => {
  // The point of persisting them: without this, a kiosk reload re-armed a
  // compressor that had just stopped.
  const thermostat = new AirconAutoThermostat();
  thermostat.reconcile(
    airconAutoCycleStateFromPreferences({
      autoLastMode: "heat",
      autoLastModeAt: NOW - 2 * MINUTE,
      autoLastTransitionAt: NOW - 2 * MINUTE,
      autoRecentStartsAt: [NOW - 2 * MINUTE],
    }),
  );

  const plan = thermostat.plan({
    currentTemperature: 18,
    entity: climateEntity({ state: "off", attributes: { current_temperature: 18, temperature: 22 } }),
    now: NOW,
    preferences: { autoMode: true },
  });

  assert.equal(plan.reason, "min-cycle-hold");
});
