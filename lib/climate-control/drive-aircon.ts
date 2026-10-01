import {
  airconAutoCycleStateFromPreferences,
  airconAutoMeasuredTemperature,
  climateTargetTemperature,
  isClimateEntityOn,
} from "../aircon-control";
import { firstState, freshSensorValue, planDryEmulationTick } from "../aircon-dry";
import type { AirconInstance } from "../climate-instances";
import { airconPreferencesFor } from "../climate-preferences";
import type { DashboardEntity, DashboardPreferences, HaState } from "../types";
import { AIRCON_MIN_OFF_MS } from "./constants";
import type { Direction } from "./types";
import { airconControlMode } from "./mode-model";
import { airconThermostatFor, roomState, samplesFor } from "./store";
import {
  airconEntityFor,
  airconSignature,
  airconSupportedModes,
  emulatesDry,
  median,
  noteSample,
  rawAsDashboardEntity,
  usable,
} from "./device-model";
import { emitClimateControllerWrite } from "./attribution";
import { executeActions, observeActuator, stopAndCancel } from "./commands";
import { driveManualAircon } from "./drive-aircon-manual";
import { airconTickDirection } from "./aircon-direction-model";

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
  /**
   * The room's own thermostat just switched the unit off because it reached the
   * target. Unlike `forcedOff` this is NOT a mode change: Auto and Manual both
   * rest the compressor at target and pick it up again when the room drifts, so
   * the selected mode stands and only the phase moves to "resting". Reporting
   * this as "off" is what made Manual deselect itself (specs/aircon-auto-control.md §5).
   */
  restingNow: boolean;
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
  // A reading older than AUTONOMOUS_CLIMATE_INPUT_MAX_AGE_MS (30 minutes) or an
  // unavailable entity reads as null, and the median of five such readings is no
  // better than the newest of them. Drop the buffer so the loops below see no
  // reading at all rather than starting on half-hour-old data — we do not run
  // heating or cooling blind (Adeline, 2026-09-19).
  if (rawTemperature === null) samples.length = 0;
  noteSample(samples, rawTemperature);
  const filteredTemperature = median(samples);
  const mode = airconControlMode({
    storedMode: room.mode,
    autoMode: prefs?.autoMode,
    manualDirection: room.manualDirection,
    unitOn: Boolean(aircon && isClimateEntityOn(aircon)),
  });
  // The direction the unit is physically running. A stop is judged against this
  // and never against the wanted direction: heating a room past its target must
  // stop rather than flip to cooling (specs/aircon-auto-control.md §6).
  const runningDirection = aircon && ["heat", "cool", "dry", "fan_only"].includes(aircon.state)
    ? (aircon.state as Direction)
    : null;
  const targetTemperature = prefs?.temperature ?? (aircon ? climateTargetTemperature(aircon) : undefined) ?? null;
  const seated = mode === "manual" ? room.manualDirection : null;
  const direction = airconTickDirection({
    filteredTemperature,
    mode,
    preferences: prefs,
    rawTemperature,
    running: runningDirection,
    seated,
    target: targetTemperature,
  });
  const external = room.owner === "external";
  let forcedOff = false;
  let restingNow = false;

  const offTimer = prefs?.offTimerEndsAt;
  const sleepTimerExpired = typeof offTimer === "string" && Date.parse(offTimer) <= now;

  // The loop stands down while someone else has the unit, but an armed sleep
  // timer is the owner's own instruction and outlives that stand-down: used as a
  // guard on the whole block, a timer set minutes before a device override was
  // never evaluated again and the unit ran all night (2026-10-02). All the timer
  // does is turn the unit off, so honouring it cannot fight the person holding
  // the remote. See specs/aircon-auto-control.md, "Sleep timer".
  if (aircon && usable(aircon) && (!external || sleepTimerExpired)) {
    if (sleepTimerExpired) {
      await stopAndCancel(unit, aircon.entity_id, "timer-expired", {}, { whileSuspended: true });
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
      if (plan.reason === "sensor-pending" && plan.actions.length) {
        // Nova is switching the owner's unit off with nobody asking, so it has to
        // be explainable afterwards (specs/bedroom-heater-control-integrity.md §5).
        // Auto stays armed: the mode is hers, and the loop resumes on its own when
        // a reading returns.
        room.lastStopReason = "sensor-unavailable";
        emitClimateControllerWrite({
          instanceId: unit.id,
          reason: plan.reason,
          modeBefore: "auto",
          modeAfter: "auto",
          target: prefs?.temperature,
          sensorTemperature: null,
          sensorAgeSeconds: null,
          sensorUnusableReason: aircon.state === "off" ? "unit-off-no-reading" : "stale-or-non-numeric",
        });
      }
      await executeActions(unit, plan.actions);
      if (plan.reason === "reached-target") room.lastStopReason = "target-reached";
      if (plan.reason === "sensor-pending" && plan.actions.length) restingNow = true;
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
      restingNow = await driveManualAircon({
        aircon,
        direction,
        filteredTemperature,
        now,
        prefs,
        rawTemperature,
        room,
        runningDirection: runningDirection === "heat" || runningDirection === "cool" ? runningDirection : null,
        targetTemperature,
        unit,
      });
    }
  }

  return { unit, aircon, mode, direction, external, rawTemperature, forcedOff, restingNow };
}

