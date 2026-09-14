import { readDashboardConfigSync } from "../dashboard-config";
import { callServiceWithResponse } from "../ha/client";
import { samplePowerNow } from "../power";
import { updaterBusy } from "../update";
import { readOrbTimer } from "../orb-timer";
import { readTasks } from "../tasks";
import { normalizeOrbParams } from "./preferences";
import { orbModuleById, type OrbInfoSources } from "./catalogue";
import { ORB_MODULE_OUTPUT_EMPTY, type OrbModuleOutput, type OrbStackEntry } from "./types";

type Memory = { power: Array<{ at: number; watts: number }>; forecast: Record<string, unknown>[]; forecastAt: number };
const holder = globalThis as typeof globalThis & { __novaOrbEvents?: Memory };
const memory = holder.__novaOrbEvents ??= { power: [], forecast: [], forecastAt: 0 };
export async function readOrbEvents(entries: OrbStackEntry[]): Promise<Record<string, OrbModuleOutput>> {
  const now = Date.now();
  const ids = new Set(entries.map((entry) => entry.moduleId));
  const power = ids.has("power-high") || ids.has("washing") ? await samplePowerNow() : null;
  if (power) {
    memory.power.push({ at: now, watts: power.currentWatts });
    memory.power = memory.power.filter((sample) => now - sample.at <= 3_660_000);
  }
  if (ids.has("rain-arriving") && now - memory.forecastAt > 60_000) {
    const entity = readDashboardConfigSync().homeAssistant.weatherEntityId;
    try {
      const result = await callServiceWithResponse<{ service_response?: Record<string, { forecast?: Record<string, unknown>[] }> }>("weather", "get_forecasts", { entity_id: entity, type: "hourly" });
      memory.forecast = result.service_response?.[entity]?.forecast ?? [];
      memory.forecastAt = now;
    } catch { memory.forecast = []; }
  }
  const timer = ids.has("timer") ? await readOrbTimer() : null;
  const tasks = ids.has("washing") ? await readTasks() : [];
  const busy = ids.has("update-running") ? await updaterBusy() : false;
  const outputs: Record<string, OrbModuleOutput> = {};
  for (const entry of entries) {
    const params = normalizeOrbParams(entry.params, orbModuleById(entry.moduleId));
    let value: OrbModuleOutput = { ...ORB_MODULE_OUTPUT_EMPTY, active: false };
    if (entry.moduleId === "rain-arriving") {
      const rain = memory.forecast.filter((hour) => Number(hour.precipitation_probability) >= Number(params.chancePct))
        .map((hour) => Date.parse(String(hour.datetime))).filter((at) => at >= now && at <= now + Number(params.withinMinutes) * 60_000).sort((a, b) => a - b)[0];
      if (rain !== undefined) value = { ...value, active: true, status: "ok", icon: "umbrella", text: `${Math.ceil((rain - now) / 60_000)} min` };
    } else if (entry.moduleId === "power-high" && power) {
      const duration = Number(params.minutes) * 60_000;
      const threshold = Number(params.kilowatts) * 1000;
      const samples = memory.power.filter((sample) => sample.at >= now - duration - 10_000);
      const sustained = samples.length > 1 && samples[0].at <= now - duration && samples.every((sample, i) => sample.watts > threshold && (!i || sample.at - samples[i - 1].at < 15_000));
      if (sustained) value = { ...value, active: true, status: "ok", icon: "lightning", text: `${(power.currentWatts / 1000).toFixed(1)} kW` };
    } else if (entry.moduleId === "update-running") {
      value = { ...value, active: busy, status: "ok", icon: "spinner", text: "Updating" };
    } else if (entry.moduleId === "washing" || entry.moduleId === "timer") {
      const sources: OrbInfoSources = { now, orbTimer: timer, washing: power?.washingMachine, washTasks: tasks,
        watchface: null, power: null, novaLoad: null, dashboardState: null, tasks: null };
      value = orbModuleById(entry.moduleId).read(sources, params);
    }
    outputs[entry.id] = value;
    outputs[`${entry.moduleId}:${JSON.stringify(params)}`] = value;
  }
  return outputs;
}
