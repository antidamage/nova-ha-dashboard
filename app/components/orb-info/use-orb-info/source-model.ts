"use client";

import type { OrbInfoSources, OrbModuleOutput } from "../../../../lib/orb-info/types";
import type { DashboardState, Task } from "../../../../lib/types";
import { isTaskAlerting, taskAlertSessionKey } from "../../tasks/task-model";
import { MS_PER_HOUR } from "./constants";
import type { DashboardSource } from "./types";

export function millisFromIso(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Project the heavy dashboard state down to the few fields modules read. */
export function dashboardSourceFrom(state: DashboardState | null): DashboardSource {
  if (!state) return null;
  const entities = state.entities ?? [];
  const byId = new Map(entities.map((entity) => [entity.entity_id, entity]));
  const entityNumber = (entityId: string | null | undefined) => {
    if (!entityId) return null;
    return numberOrNull(byId.get(entityId)?.state);
  };

  const zones = (state.zones ?? []).map((zone) => {
    const fallback = state.zoneEnvironmentFallbacks?.find((entry) => entry.zoneId === zone.id);
    // The HA-native area binding wins; the configured fallbacks only fill gaps,
    // which is the same precedence the environment panels use.
    const temperature = entityNumber(zone.environment?.temperatureEntityId)
      ?? (fallback?.temperatureEntityIds ?? []).map(entityNumber).find((value) => value !== null) ?? null;
    const humidity = entityNumber(zone.environment?.humidityEntityId)
      ?? (fallback?.humidityEntityIds ?? []).map(entityNumber).find((value) => value !== null) ?? null;
    return { id: zone.id, name: zone.name, temperatureC: temperature, humidityPct: humidity };
  });

  const numericEntities = entities
    .filter((entity) => numberOrNull(entity.state) !== null)
    .map((entity) => ({
      entityId: entity.entity_id,
      name: entity.name,
      value: numberOrNull(entity.state),
      unit: typeof entity.attributes?.unit_of_measurement === "string"
        ? entity.attributes.unit_of_measurement
        : null,
    }));

  return {
    outsideTemperature: numberOrNull(state.weather?.temperature),
    outsideFeelsLike: numberOrNull(state.weather?.feelsLike),
    humidity: numberOrNull(state.weather?.humidity),
    rainChancePct: numberOrNull(state.weather?.rainChancePct),
    uvIndex: numberOrNull(state.weather?.uvIndex),
    windSpeed: numberOrNull(state.weather?.windSpeed),
    forecastHigh: numberOrNull(state.weather?.high),
    forecastLow: numberOrNull(state.weather?.low),
    nextSetting: state.sun?.nextSetting ?? null,
    nextRising: state.sun?.nextRising ?? null,
    sunState: state.sun?.state ?? null,
    haHealthy: state.haHealth ? state.haHealth.status === "ok" : true,
    wanConnected: state.router?.wanConnected ?? null,
    lightsOn: entities.filter((entity) => entity.domain === "light" && entity.state === "on").length,
    openingsOpen: entities.filter((entity) => entity.domain === "cover" && entity.state === "open").length,
    unavailableCount: entities.filter((entity) => entity.state === "unavailable").length,
    generatedAt: state.generatedAt ?? null,
    zones,
    numericEntities,
  };
}

/** Reduce the reminder list to the two numbers the readout modules want. */
export function tasksSourceFrom(tasks: Task[], now: number): NonNullable<OrbInfoSources["tasks"]> {
  const live = tasks.filter((task) => !task.dismissedAt);
  let nextDueAt: number | null = null;
  let overdueCount = 0;
  for (const task of live) {
    const start = Date.parse(task.start);
    if (!Number.isFinite(start)) continue;
    if (start <= now) {
      overdueCount += 1;
    } else if (nextDueAt === null || start < nextDueAt) {
      nextDueAt = start;
    }
  }
  const alerting = live.filter((task) => isTaskAlerting(task, now))
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))
    .map((task) => ({ id: task.id, start: task.start }));
  return {
    alerting,
    nextDueInHours: nextDueAt === null ? null : Math.max(0, nextDueAt - now) / MS_PER_HOUR,
    nextDueAt: nextDueAt === null ? null : new Date(nextDueAt).toISOString(),
    overdueCount,
  };
}

/** Mark a reminder's current occurrence acknowledged, as the server does. */
export function applyTaskDismissal(tasks: Task[], taskId: string, at = new Date().toISOString()): Task[] {
  return tasks.map((task) => {
    if (task.id !== taskId) return task;
    const session = taskAlertSessionKey(task);
    // Same test as isTaskAlertSilenced: an earlier occurrence's acknowledgement does not count.
    if (task.alertDismissedFor === session) return task;
    return { ...task, alertDismissedAt: at, alertDismissedFor: session, alertChimedFor: session };
  });
}

/** One alert occurrence: a dismissal hides only this, never a later occurrence of the same task. */
export function dismissalKey(output: Pick<OrbModuleOutput, "dismiss" | "alertAt">): string {
  return `${output.dismiss?.kind}:${output.dismiss?.id}:${output.alertAt ?? ""}`;
}
