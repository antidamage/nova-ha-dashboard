import type { EntityActionInput } from "../aircon-control";
import { readDashboardConfig } from "../dashboard-config";
import type { AirconInstance, ClimateInstance } from "../climate-instances";
import { airconPreferencesFor, airconPreferencesPatch, heaterPreferencesPatch } from "../climate-preferences";
import { callService, haRest } from "../ha/client";
import { mergeDashboardPreferences, readDashboardPreferences } from "../preferences";
import type { DashboardPreferences, HaState } from "../types";
import { actuatorChangeIsExternal, poweredActuatorRecoveryIsExternal } from "../climate-control-policy";
import { emitClimateControllerWrite } from "./attribution";
import { COMMAND_SETTLE_MS } from "./constants";
import { airconThermostatFor, heaterThermostatFor, persistSoon, roomState } from "./store";
import { findNamedSwitch, rawAsDashboardEntity, signatureFor } from "./device-model";

/** Owner asked for Dry on a unit Nova emulates it for. */
export async function requestEmulatedDry(unit: AirconInstance, now: number) {
  const room = roomState(unit.id);
  room.mode = "manual";
  room.manualDirection = "dry";
  room.dryUserRequestAt = now;
  room.dryOffByEmulation = false;
  airconThermostatFor(unit.id).resetForUserRequest();
  await mergeDashboardPreferences(airconPreferencesPatch(unit.id, { autoMode: false, hvacMode: "dry" }));
}

/**
 * Leaving emulated Dry, however it happens: forget its bookkeeping and put back
 * the owner's target, which emulation replaced with room minus one.
 *
 * The restore is a write of its own, so it happens only while the room is Nova's.
 * An expired sleep timer stops the unit and nothing else: the caller's allowance
 * covers its `turn_off` alone, and must not be forwarded here, or the person who
 * just took the unit by hand has their setpoint overwritten at the moment Nova
 * stands down from it.
 */
export async function leaveEmulatedDry(unit: AirconInstance, entityId: string | undefined) {
  const room = roomState(unit.id);
  const restore = room.drySetpointChanged;
  room.dryUserRequestAt = null;
  room.dryOffByEmulation = false;
  room.drySetpointChanged = false;
  if (!restore || !entityId) return;
  const target = airconPreferencesFor(await readDashboardPreferences(), unit.id)?.temperature;
  if (typeof target === "number" && Number.isFinite(target)) {
    await executeActions(unit, [{ entityId, domain: "climate", service: "set_temperature", data: { temperature: target } }]);
  }
}

function setExternal(instance: ClimateInstance, reason: string) {
  const room = instance.id;
  const state = roomState(room);
  state.owner = "external";
  state.overrideReason = reason;
  state.commandSettleUntil = 0;
  if (instance.kind === "aircon") airconThermostatFor(room).resetForUserRequest();
  else heaterThermostatFor(room).resetForUserRequest();
  console.warn(`[climate-control] ${room} external override; Nova automation suspended`);
}

function observeExternalChanges(instance: ClimateInstance, signature: string | null, now: number) {
  const room = instance.id;
  const state = roomState(room);
  if (signature === null) return;
  if (state.observedSignature === null) {
    state.observedSignature = signature;
    return;
  }
  if (signature === state.observedSignature) return;
  if (!actuatorChangeIsExternal({
    previousSignature: state.observedSignature,
    currentSignature: signature,
    commandSettleUntil: state.commandSettleUntil,
    now,
  })) {
    state.observedSignature = signature;
    return;
  }
  if (state.owner === "nova") setExternal(instance, "device-override");
  state.observedSignature = signature;
}

export function observeActuator(instance: ClimateInstance, signature: string | null, now: number) {
  const state = roomState(instance.id);
  const available = signature !== null;
  const recoveredPowered = poweredActuatorRecoveryIsExternal({
    wasAvailable: state.actuatorWasAvailable,
    currentSignature: signature,
    commandSettleUntil: state.commandSettleUntil,
    now,
  });
  state.actuatorWasAvailable = available;
  if (recoveredPowered && state.owner === "nova" && signature) {
    setExternal(instance, "device-reconnected-on");
    state.observedSignature = signature;
    return;
  }
  observeExternalChanges(instance, signature, now);
}

export async function statesAndDevices() {
  const config = await readDashboardConfig();
  const states = await haRest<HaState[]>("/api/states");
  const quietRaw = findNamedSwitch(states, ["quiet"]);
  const turboRaw = findNamedSwitch(states, ["turbo"]);
  const quiet = quietRaw ? rawAsDashboardEntity(quietRaw) : undefined;
  const turbo = turboRaw ? rawAsDashboardEntity(turboRaw) : undefined;
  return { config, states, quiet, turbo };
}

export async function executeActions(
  instance: ClimateInstance,
  actions: EntityActionInput[],
  allowWhileExternal = false,
) {
  const room = instance.id;
  if (roomState(room).owner !== "nova" && !allowWhileExternal) return;
  for (const action of actions) {
    if (roomState(room).owner !== "nova" && !allowWhileExternal) return;
    const before = await haRest<HaState[]>("/api/states");
    observeActuator(instance, signatureFor(instance, before, action.entityId), Date.now());
    if (roomState(room).owner !== "nova" && !allowWhileExternal) return;
    roomState(room).commandSettleUntil = Date.now() + COMMAND_SETTLE_MS;
    const result = await callService(action.domain, action.service, {
      entity_id: action.entityId,
      ...(action.data ?? {}),
    });
    if (action.remember) await mergeDashboardPreferences(action.remember);
    const resultStates = result.length ? result : await haRest<HaState[]>("/api/states");
    const afterSignature = signatureFor(instance, resultStates, action.entityId);
    if (afterSignature) roomState(room).observedSignature = afterSignature;
  }
  await persistSoon();
}

export async function stopAndCancel(
  instance: ClimateInstance,
  entityId: string,
  reason: string,
  sensorDetail: {
    sensorTemperature?: number | null;
    sensorAgeSeconds?: number | null;
    sensorUnusableReason?: string | null;
  } = {},
  /**
   * An expired sleep timer is the owner's own standing instruction, and all it
   * ever does is turn the device off, so it is executed even while the room is
   * suspended after a device override — see `driveAircon`. Both callers today
   * are timer paths and pass true; the default is false so that anything else
   * reaching this function cannot command a device that is in someone else's
   * hands. The allowance covers this function's own stop and nothing else.
   */
  options: { whileSuspended?: boolean } = {},
) {
  const allowWhileExternal = options.whileSuspended === true;
  const now = Date.now();
  const room = instance.id;
  roomState(room).lastStopReason = reason;
  // Unlike a thermostat resting at target, this ends the mode as well as the
  // run: an expired sleep timer is the owner's own instruction, and the sensor
  // fail-safe is documented as clearing Auto (§6).
  roomState(room).mode = "off";
  roomState(room).lastTransitionAt = now;
  roomState(room).sensorPendingSinceAt = null;
  roomState(room).settlingFromTemperature = null;
  // This clears Auto as well as stopping the element, so it is exactly the
  // kind of write nobody asked for that must be explainable afterwards
  // (specs/bedroom-heater-control-integrity.md §5).
  emitClimateControllerWrite({
    instanceId: room,
    reason,
    modeBefore: "auto",
    modeAfter: "off",
    ...sensorDetail,
  });
  if (instance.kind === "aircon") {
    airconThermostatFor(room).resetForUserRequest();
    roomState(room).manualDirection = null;
    await executeActions(instance, [{ entityId, domain: "climate", service: "turn_off" }], allowWhileExternal);
    // No allowance forwarded: the restore is a second write, and it is not the
    // timer's. See `leaveEmulatedDry`.
    await leaveEmulatedDry(instance, entityId);
    await mergeDashboardPreferences(airconPreferencesPatch(room, { autoMode: false, offTimerEndsAt: null }));
  } else {
    heaterThermostatFor(room).resetForUserRequest();
    await executeActions(instance, [{ entityId, domain: "switch", service: "turn_off" }], allowWhileExternal);
    await mergeDashboardPreferences(heaterPreferencesPatch(room, { mode: "off", offTimerEndsAt: null }));
  }
}

