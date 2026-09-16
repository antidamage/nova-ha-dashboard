import {
  AIRCON_SENSOR_SETTLE_MS,
  AIRCON_SENSOR_RESOLUTION_DEGREES,
  AIRCON_SENSOR_TIME_CONSTANT_MS,
  AIRCON_USER_REQUEST_MAX_AGE_MS,
  airconAutoCycleStateFromPreferences,
  airconAutoMeasuredTemperature,
  isClimateEntityOn,
} from "../aircon-control";
import { firstState, freshSensorValue, planDryEmulationTick } from "../aircon-dry";
import type { AirconInstance } from "../climate-instances";
import { airconPreferencesFor } from "../climate-preferences";
import type { DashboardEntity, DashboardPreferences, HaState } from "../types";
import { planManualAirconTick } from "../climate-control-policy";
import { AIRCON_MIN_OFF_MS, AIRCON_SAME_DIRECTION_RESUME_DRIFT_C } from "./constants";
import type { Direction } from "./types";
import { airconThermostatFor, roomState, samplesFor } from "./store";
import {
  airconEntityFor,
  airconSignature,
  airconSupportedModes,
  emulatesDry,
  median,
  noteSample,
  pruneStarts,
  rawAsDashboardEntity,
  usable,
} from "./device-model";
import { executeActions, observeActuator, stopAndCancel } from "./commands";

/** What driving one instance produced, for building its public state after. */
export type AirconTickResult = {
  unit: AirconInstance;
  aircon?: DashboardEntity;
  mode: "auto" | "manual" | "off";
  direction: Direction | null;
  external: boolean;
  rawTemperature: number | null;
  /**
   * Set when stopAndCancel ran this tick. The `states`/`aircon` snapshot and
   * the `mode` computed above it were both read before that call, so they
   * still describe the pre-stop unit — reporting them as this tick's public
   * state would show a driving/auto unit for a beat after Nova just forced it
   * off (a real HA turn_off plus autoMode:false), which reads as a soft,
   * internal-only stop rather than the state actually changing. The caller
   * uses this to report "off" immediately instead of waiting for the next
   * tick's fresh HA states to catch up.
   */
  forcedOff: boolean;
};

export async function driveAircon(
  unit: AirconInstance,
  states: HaState[],
  quiet: DashboardEntity | undefined,
  turbo: DashboardEntity | undefined,
  preferences: DashboardPreferences,
  now: number,
): Promise<AirconTickResult> {
  const room = roomState(unit.id);
  const raw = airconEntityFor(states, unit);
  const aircon = raw ? rawAsDashboardEntity(raw) : undefined;
  const prefs = airconPreferencesFor(preferences, unit.id);
  const thermostat = airconThermostatFor(unit.id);
  const samples = samplesFor(unit.id);

  observeActuator(unit, airconSignature(states, unit), now);

  const rawTemperature = airconAutoMeasuredTemperature(aircon, now);
  noteSample(samples, rawTemperature);
  const filteredTemperature = median(samples);
  const mode = prefs?.autoMode
    ? "auto"
    : room.manualDirection
    ? "manual"
    : aircon && isClimateEntityOn(aircon)
    ? "manual"
    : "off";
  const direction = mode === "manual" && room.manualDirection
    ? room.manualDirection
    : aircon && ["heat", "cool", "dry", "fan_only"].includes(aircon.state)
    ? (aircon.state as Direction)
    : (prefs?.hvacMode as Direction | undefined) ?? null;
  const external = room.owner === "external";
  let forcedOff = false;

  if (aircon && usable(aircon) && !external) {
    const offTimer = prefs?.offTimerEndsAt;
    if (typeof offTimer === "string" && new Date(offTimer).getTime() <= now) {
      await stopAndCancel(unit, aircon.entity_id, "timer-expired");
      forcedOff = true;
    } else if (prefs?.autoMode) {
      thermostat.reconcile({
        ...airconAutoCycleStateFromPreferences(prefs),
        sensorPendingSinceAt: room.sensorPendingSinceAt,
      });
      const measured = isClimateEntityOn(aircon) ? rawTemperature : filteredTemperature;
      const plan = thermostat.plan({
        currentTemperature: measured,
        entity: aircon,
        preferences: prefs,
        quietSwitch: quiet,
        turboSwitch: turbo,
      });
      room.sensorPendingSinceAt = plan.nextState.sensorPendingSinceAt;
      if (plan.reason === "sensor-fail-safe-off") {
        await stopAndCancel(unit, aircon.entity_id, "sensor-timeout");
        forcedOff = true;
      } else {
        await executeActions(unit, plan.actions);
        if (plan.reason === "reached-target") room.lastStopReason = "target-reached";
      }
    } else if (
      mode === "manual" &&
      direction === "dry" &&
      emulatesDry(unit, aircon)
    ) {
      // specs/aircon-auto-control.md, "Dry emulation".
      const minTemperature = Number(aircon.attributes.min_temp);
      const decision = planDryEmulationTick({
        humidityPct: freshSensorValue(firstState(states, unit.humidityEntityIds), now),
        roomTemperatureC: freshSensorValue(firstState(states, unit.temperatureEntityIds), now),
        targetHumidityPct: unit.dryTargetHumidityPct ?? 55,
        entityState: aircon.state,
        supportedModes: airconSupportedModes(aircon),
        fanModes: Array.isArray(aircon.attributes.fan_modes) ? aircon.attributes.fan_modes.map(String) : [],
        minTemperatureC: Number.isFinite(minTemperature) ? minTemperature : 16,
        now,
        lastTransitionAt: room.lastTransitionAt,
        minDwellMs: AIRCON_MIN_OFF_MS,
        mayStartFromOff: typeof room.dryUserRequestAt === "number" || room.dryOffByEmulation,
      });
      if (decision.kind !== "hold") {
        room.dryUserRequestAt = null;
        room.dryOffByEmulation = decision.kind === "off";
      }
      if (decision.kind === "cool") {
        room.lastTransitionAt = now;
        room.recentStartsAt.push(now);
        room.drySetpointChanged = true;
        await executeActions(unit, [
          { entityId: aircon.entity_id, domain: "climate", service: "set_hvac_mode", data: { hvac_mode: "cool" } },
          { entityId: aircon.entity_id, domain: "climate", service: "set_temperature", data: { temperature: decision.setpointC } },
          ...(decision.fanMode
            ? [{ entityId: aircon.entity_id, domain: "climate" as const, service: "set_fan_mode", data: { fan_mode: decision.fanMode } }]
            : []),
        ]);
      } else if (decision.kind === "fan_only" || decision.kind === "off") {
        if (aircon.state === "cool") room.lastTransitionAt = now;
        room.lastStopReason = "target-reached";
        await executeActions(unit, [decision.kind === "off"
          ? { entityId: aircon.entity_id, domain: "climate", service: "turn_off" }
          : { entityId: aircon.entity_id, domain: "climate", service: "set_hvac_mode", data: { hvac_mode: "fan_only" } }]);
      }
    } else if (mode === "manual" && (direction === "heat" || direction === "cool")) {
      const target = prefs?.temperature ?? Number(aircon.attributes.temperature);
      pruneStarts(room, now);
      // Latch a target the owner moved, exactly as Auto does. Read as a number
      // rather than against null so a state file written before this field
      // existed does not read as a change on the first tick after a deploy.
      if (Number.isFinite(target)) {
        if (typeof room.manualTargetTemperature === "number" && room.manualTargetTemperature !== target) {
          room.manualUserRequestAt = now;
        }
        room.manualTargetTemperature = target;
      }
      if (
        typeof room.manualUserRequestAt === "number" &&
        now - room.manualUserRequestAt >= AIRCON_USER_REQUEST_MAX_AGE_MS
      ) {
        room.manualUserRequestAt = null;
      }
      const userRequested = typeof room.manualUserRequestAt === "number";
      const decision = Number.isFinite(target)
        ? planManualAirconTick({
            direction,
            isOn: isClimateEntityOn(aircon),
            userRequested,
            rawTemperature,
            filteredTemperature,
            targetTemperature: target,
            now,
            lastTransitionAt: room.lastTransitionAt,
            settlingFromTemperature: room.settlingFromTemperature,
            minOffMs: AIRCON_MIN_OFF_MS,
            sensorSettleMs: AIRCON_SENSOR_SETTLE_MS,
            sensorResolutionC: AIRCON_SENSOR_RESOLUTION_DEGREES,
            sensorTimeConstantMs: AIRCON_SENSOR_TIME_CONSTANT_MS,
            resumeDriftC: AIRCON_SAME_DIRECTION_RESUME_DRIFT_C,
          })
        : "hold";
      // Every outcome above is an answer once a request is latched — driving
      // already, started now, or the target is met — so none of them defer it.
      if (userRequested) room.manualUserRequestAt = null;
      if (decision === "stop") {
        room.lastTransitionAt = now;
        room.settlingFromTemperature = rawTemperature;
        room.lastStopReason = "target-reached";
        await executeActions(unit, [{ entityId: aircon.entity_id, domain: "climate", service: "turn_off" }]);
        forcedOff = true;
      } else if (decision === "start") {
        room.lastTransitionAt = now;
        room.settlingFromTemperature = null;
        room.recentStartsAt.push(now);
        await executeActions(unit, [{
          entityId: aircon.entity_id,
          domain: "climate",
          service: "set_hvac_mode",
          data: { hvac_mode: direction },
        }]);
      }
    }
  }

  return { unit, aircon, mode, direction, external, rawTemperature, forcedOff };
}

