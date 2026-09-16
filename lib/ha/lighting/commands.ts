// The lighting service call path: superseded-command checks, staged light
// values on switch-on, and the fan-out helpers every lighting action uses.
import type { DashboardEntity } from "../../types";
import { callService } from "../client";
import { clearStagedLightValues, stagedLightValue } from "../../light-event-state";
import { SupersededLightingCommandError } from "../../lighting-command-coordinator";
import type { LatestCommandControl } from "./types";

export function assertLatestCommandCurrent(control?: LatestCommandControl) {
  if (control?.isCurrent && !control.isCurrent()) {
    throw new SupersededLightingCommandError();
  }
}

function latestLightingServiceKey(domain: string, serviceData: Record<string, unknown>) {
  const entityId = serviceData.entity_id;
  if (typeof entityId === "string" && entityId.trim()) {
    return `${domain}:${entityId.trim()}`;
  }
  if (Array.isArray(entityId)) {
    return `${domain}:${entityId.map(String).sort().join(",")}`;
  }

  return `${domain}:${JSON.stringify(serviceData)}`;
}

export async function callLightingService(
  domain: "light" | "switch",
  service: string,
  serviceData: Record<string, unknown>,
  control?: LatestCommandControl,
) {
  assertLatestCommandCurrent(control);
  // A light switched on while a light event has a value staged for it comes up
  // at that value, once (specs/zone-light-events.md). Switching one off drops
  // anything staged for it.
  const payload = service === "turn_on"
    ? await withStagedLightValue(domain, serviceData)
    : serviceData;
  if (service === "turn_off") {
    await clearStagedForServiceData(serviceData);
  }
  return callService(domain, service, payload, {
    latestKey: latestLightingServiceKey(domain, payload),
    signal: control?.signal,
  });
}

function entityIdsFromServiceData(serviceData: Record<string, unknown>): string[] {
  const entityId = serviceData.entity_id;
  if (typeof entityId === "string") return [entityId];
  if (Array.isArray(entityId)) return entityId.map(String);
  return [];
}

async function clearStagedForServiceData(serviceData: Record<string, unknown>) {
  await clearStagedLightValues(entityIdsFromServiceData(serviceData));
}

async function withStagedLightValue(
  domain: "light" | "switch",
  serviceData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const entityIds = entityIdsFromServiceData(serviceData);
  if (domain !== "light" || entityIds.length !== 1) return serviceData;

  const staged = await stagedLightValue(entityIds[0]);
  if (!staged) return serviceData;

  await clearStagedLightValues(entityIds);
  return {
    ...serviceData,
    brightness_pct: staged.brightnessPct,
    rgb_color: staged.rgb,
  };
}

export async function callMany(tasks: Promise<unknown>[]) {
  const results = await Promise.allSettled(tasks);
  const failures = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
  if (failures.length && failures.length === results.length) {
    throw failures[0].reason;
  }
}

export function setEntityPower(entity: DashboardEntity, on: boolean, control?: LatestCommandControl) {
  if (entity.domain !== "light" && entity.domain !== "switch") {
    return Promise.resolve();
  }

  return callLightingService(entity.domain, on ? "turn_on" : "turn_off", { entity_id: entity.entity_id }, control);
}
