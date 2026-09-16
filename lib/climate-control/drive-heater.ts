import {
  bedroomHeaterMode,
  bedroomHeaterSleepTimerExpired,
  bedroomTemperatureStateIsFresh,
} from "../bedroom-heater-control";
import type { HeaterInstance } from "../climate-instances";
import { heaterPreferencesFor } from "../climate-preferences";
import type { DashboardPreferences, HaState } from "../types";
import { heaterThermostatFor, roomState } from "./store";
import { heaterEntityFor, heaterSensorFor, heaterSignature, usable } from "./device-model";
import { executeActions, observeActuator, stopAndCancel } from "./commands";

export type HeaterTickResult = {
  instance: HeaterInstance;
  heater?: HaState;
  sensor?: HaState;
  mode: ReturnType<typeof bedroomHeaterMode>;
  sensorAvailable: boolean;
};

export async function driveHeater(
  instance: HeaterInstance,
  states: HaState[],
  preferences: DashboardPreferences,
  now: number,
): Promise<HeaterTickResult> {
  const room = roomState(instance.id);
  const heater = heaterEntityFor(states, instance);
  const sensor = heaterSensorFor(states, instance);
  const thermostat = heaterThermostatFor(instance.id);

  observeActuator(instance, heaterSignature(heater), now);

  const prefs = heaterPreferencesFor(preferences, instance.id);
  const mode = bedroomHeaterMode(prefs);
  const temperature = Number(bedroomTemperatureStateIsFresh(sensor, now) ? sensor?.state : Number.NaN);
  const sensorAvailable = Number.isFinite(temperature);

  if (heater && usable(heater) && room.owner === "nova") {
    if (bedroomHeaterSleepTimerExpired(prefs, now)) {
      await stopAndCancel(instance, heater.entity_id, "timer-expired");
    } else if (mode === "off" && heater.state === "on") {
      room.lastStopReason = "nova-off";
      await executeActions(instance, [{ entityId: heater.entity_id, domain: "switch", service: "turn_off" }]);
    } else if (mode === "auto") {
      thermostat.reconcile({
        lastTransitionAt: room.lastTransitionAt,
        sensorPendingSinceAt: room.sensorPendingSinceAt,
      });
      const plan = thermostat.plan({
        currentTemperature: sensorAvailable ? temperature : null,
        entityId: heater.entity_id,
        isOn: heater.state === "on",
        now,
        preferences: prefs,
      });
      room.lastTransitionAt = plan.nextState.lastTransitionAt;
      room.sensorPendingSinceAt = plan.nextState.sensorPendingSinceAt;
      if (plan.reason === "sensor-fail-safe-off") {
        await stopAndCancel(instance, heater.entity_id, "sensor-timeout");
      } else {
        await executeActions(instance, plan.actions);
        if (["reached-target", "above-target"].includes(plan.reason)) room.lastStopReason = "target-reached";
      }
    }
  }

  return { instance, heater, sensor, mode, sensorAvailable };
}
