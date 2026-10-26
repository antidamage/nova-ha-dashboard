import { firstState, freshSensorValue, planDryEmulationTick } from "../aircon-dry";
import type { AirconInstance } from "../climate-instances";
import type { DashboardEntity, HaState } from "../types";
import { AIRCON_MIN_OFF_MS } from "./constants";
import { airconSupportedModes } from "./device-model";
import { executeActions } from "./commands";
import type { PersistedRoom } from "./types";

/**
 * One tick of dry emulation, for a unit that has no dry mode of its own
 * (specs/aircon-auto-control.md, "Dry emulation"). Split out of `drive-aircon.ts`
 * (specs/agent-token-footprint.md §3.3) the way Manual is in
 * `drive-aircon-manual.ts`; the caller decides whether this tick is one.
 */
export async function driveDryEmulation({
  aircon,
  now,
  room,
  states,
  unit,
}: {
  aircon: DashboardEntity;
  now: number;
  room: PersistedRoom;
  states: HaState[];
  unit: AirconInstance;
}): Promise<void> {
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
}
