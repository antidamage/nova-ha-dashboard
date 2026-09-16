import { readDashboardConfig } from "../dashboard-config";
import { airconInstances, heaterInstances, type ClimateInstance } from "../climate-instances";
import { airconPreferencesPatch, heaterPreferencesPatch } from "../climate-preferences";
import { mergeDashboardPreferences } from "../preferences";
import type { AirconPreferences, BedroomHeaterPreferences, DashboardPreferences, HaDomain } from "../types";
import { climateActionReclaimsOwnership } from "../climate-control-policy";
import { COMMAND_SETTLE_MS } from "./constants";
import type { ClimateControlIntent, RoomId } from "./types";
import {
  airconThermostatFor,
  climateControlState,
  heaterThermostatFor,
  loadPersisted,
  persistSoon,
  roomState,
} from "./store";
import { airconEntityFor, emulatesDry, heaterEntityFor } from "./device-model";
import { executeActions, leaveEmulatedDry, requestEmulatedDry, statesAndDevices } from "./commands";
import { tick } from "./tick";

async function instanceById(id: RoomId): Promise<ClimateInstance | undefined> {
  const config = await readDashboardConfig();
  return [...airconInstances(config), ...heaterInstances(config)].find((instance) => instance.id === id);
}

export async function claimClimateControl(room: RoomId) {
  await loadPersisted();
  const state = roomState(room);
  state.owner = "nova";
  state.overrideReason = null;
  state.commandSettleUntil = Date.now() + COMMAND_SETTLE_MS;
  const instance = await instanceById(room);
  // Reset only this instance's own thermostat; the others are mid-cycle on
  // their own devices and must not have their timings cleared.
  if (instance?.kind === "heater") heaterThermostatFor(room).resetForUserRequest();
  else airconThermostatFor(room).resetForUserRequest();
  await persistSoon();
}

export async function handleLegacyClimateAction(action: {
  entityId: string;
  domain: HaDomain;
  service: string;
  data?: Record<string, unknown>;
  remember?: DashboardPreferences;
}) {
  const { config, states } = await statesAndDevices();
  const units = airconInstances(config);
  const heaters = heaterInstances(config);

  // Which configured device does this entity belong to? Heaters bind by entity
  // id; an air conditioner binds by its resolved entity, or — for its companion
  // quiet/turbo switches, which are not the climate entity — by name. With more
  // than one unit the name test cannot say which, so it stays with the first,
  // matching what a single-unit home has always done.
  const heaterMatch = heaters.find((instance) => instance.switchEntityIds.includes(action.entityId));
  const unitMatch = units.find((unit) => airconEntityFor(states, unit)?.entity_id === action.entityId);
  const looksLikeAircon =
    `${action.entityId} ${String(states.find((state) => state.entity_id === action.entityId)?.attributes.friendly_name ?? "")}`
      .toLowerCase().match(/air|quiet|turbo|xtra/) !== null;
  const instance = unitMatch ?? heaterMatch ?? (looksLikeAircon ? units[0] : undefined);
  if (!instance) return false;

  const room = instance.id;
  const isAircon = instance.kind === "aircon";
  const aircon = isAircon ? airconEntityFor(states, instance) : undefined;
  const reclaims = climateActionReclaimsOwnership({
    room: isAircon ? "lounge" : "bedroom",
    service: action.service,
    autoMode: action.remember?.aircon?.autoMode,
  });
  if (reclaims) await claimClimateControl(room);
  else await loadPersisted();

  const state = roomState(room);
  if (isAircon) {
    const leavingDry = state.manualDirection === "dry" && (
      action.service === "turn_off" ||
      action.remember?.aircon?.autoMode === true ||
      (action.service === "set_hvac_mode" && action.data?.hvac_mode !== "dry")
    );
    if (action.remember?.aircon?.autoMode === true) state.manualDirection = null;
    if (action.service === "set_hvac_mode" && action.remember?.aircon?.autoMode === false) {
      const direction = action.data?.hvac_mode;
      if (direction === "heat" || direction === "cool" || direction === "dry" || direction === "fan_only") {
        state.manualDirection = direction;
      }
    }
    if (action.remember?.aircon?.autoMode === false && state.manualDirection === null) {
      const direction = aircon?.state;
      if (direction === "heat" || direction === "cool" || direction === "fan_only") {
        state.manualDirection = direction;
      }
    }
    // Every turn_off ends Manual, whoever sent it: a remembered direction
    // would otherwise let the loop start the unit again.
    if (action.service === "turn_off") {
      state.manualDirection = null;
    }
    if (leavingDry && instance.kind === "aircon") {
      await leaveEmulatedDry(instance, aircon?.entity_id);
    }
  } else if (action.service === "turn_on") {
    // Energise the switch, but leave the stored mode alone. This branch is
    // reached by ANY generic caller — a zone "everything on" control, a scene,
    // an MCP tool call — none of which know the switch is climate-managed.
    // Promoting the heater to Auto here armed the thermostat behind the
    // owner's back; arming Auto is now an explicit climate intent only (the
    // heater card, or /api/climate-control with mode "auto"). See
    // specs/bedroom-heater-control-integrity.md §5.
    heaterThermostatFor(room).resetForUserRequest();
  } else if (action.service === "turn_off") {
    await mergeDashboardPreferences(heaterPreferencesPatch(room, { mode: "off", offTimerEndsAt: null }));
  }
  if (action.remember) await mergeDashboardPreferences(action.remember);
  if (action.service === "turn_off") {
    state.lastStopReason = "dashboard-off";
  }
  if (
    instance.kind === "aircon" &&
    action.service === "set_hvac_mode" &&
    action.data?.hvac_mode === "dry" &&
    emulatesDry(instance, aircon)
  ) {
    // The unit has no dry mode; the loop emulates it (specs/aircon-auto-control.md).
    // Voice, automations and MCP send this without `remember`, so the request is
    // recorded here rather than left to the caller.
    if (!reclaims) await claimClimateControl(room);
    await requestEmulatedDry(instance, Date.now());
    await persistSoon();
    void tick();
    return true;
  }
  await executeActions(instance, [{
    entityId: action.entityId,
    domain: action.domain,
    service: action.service,
    data: action.data,
  }], !reclaims);
  void tick();
  return true;
}

export async function applyClimateControlIntent(intent: ClimateControlIntent) {
  if (intent.mode) await claimClimateControl(intent.room);
  else await loadPersisted();
  const { states } = await statesAndDevices();
  const instance = await instanceById(intent.room);
  if (!instance) return climateControlState();

  if (instance.kind === "aircon") {
    const aircon = airconEntityFor(states, instance);
    const update: AirconPreferences = {
      ...(intent.temperature !== undefined ? { temperature: intent.temperature } : {}),
      ...(intent.direction ? { hvacMode: intent.direction } : {}),
      ...(intent.offTimerEndsAt !== undefined ? { offTimerEndsAt: intent.offTimerEndsAt } : {}),
      ...(intent.mode ? { autoMode: intent.mode === "auto" } : {}),
    };
    await mergeDashboardPreferences(airconPreferencesPatch(instance.id, update));
    const state = roomState(instance.id);
    const emulatedDry = intent.direction === "dry" && intent.mode !== "off" && intent.mode !== "auto" && emulatesDry(instance, aircon);
    const leavingDry = state.manualDirection === "dry" && !emulatedDry &&
      (intent.mode === "off" || intent.mode === "auto" || (intent.direction !== undefined && intent.direction !== "dry"));
    if (intent.mode === "off" || intent.mode === "auto") state.manualDirection = null;
    if (intent.mode === "manual" && intent.direction) state.manualDirection = intent.direction;
    if (aircon && intent.mode === "off") {
      await executeActions(instance, [{ entityId: aircon.entity_id, domain: "climate", service: "turn_off" }]);
    }
    if (leavingDry) await leaveEmulatedDry(instance, aircon?.entity_id);
    if (emulatedDry) await requestEmulatedDry(instance, Date.now());
    else if (aircon && intent.mode === "manual" && intent.direction) await executeActions(instance, [{
      entityId: aircon.entity_id, domain: "climate", service: "set_hvac_mode", data: { hvac_mode: intent.direction },
    }]);
  } else {
    const heater = heaterEntityFor(states, instance);
    const update: BedroomHeaterPreferences = {
      ...(intent.temperature !== undefined ? { temperature: intent.temperature } : {}),
      ...(intent.offTimerEndsAt !== undefined ? { offTimerEndsAt: intent.offTimerEndsAt } : {}),
      ...(intent.mode ? { mode: intent.mode === "auto" ? "auto" : "off" } : {}),
    };
    await mergeDashboardPreferences(heaterPreferencesPatch(instance.id, update));
    if (heater && intent.mode === "off") {
      await executeActions(instance, [{ entityId: heater.entity_id, domain: "switch", service: "turn_off" }]);
    }
  }
  await tick();
  return climateControlState();
}

