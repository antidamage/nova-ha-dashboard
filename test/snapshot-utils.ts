import { readFileSync } from "node:fs";
import path from "node:path";
import type { DashboardState, HaState } from "../lib/types";

export const SNAPSHOT_DIR = path.join(process.cwd(), "test", "fixtures", "ha-snapshot");

export function readSnapshotJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(SNAPSHOT_DIR, name), "utf8")) as T;
}

export type RegistryFixtures = {
  states: HaState[];
  areas: unknown[];
  devices: unknown[];
  entities: unknown[];
  labels: unknown[];
};

export function readRegistryFixtures(): RegistryFixtures {
  return {
    states: readSnapshotJson<HaState[]>("states.json"),
    areas: readSnapshotJson<unknown[]>("area-registry.json"),
    devices: readSnapshotJson<unknown[]>("device-registry.json"),
    entities: readSnapshotJson<unknown[]>("entity-registry.json"),
    labels: readSnapshotJson<unknown[]>("label-registry.json"),
  };
}

/**
 * A structural "skeleton" of dashboard state: everything that is derived from
 * HA registries + config (classification, zone projection, membership, counts)
 * with all volatile runtime values (live state, brightness, weather, router
 * numbers, timestamps, preferences) removed. This is the regression oracle for
 * the modular refactor — the skeleton must not change for a fixed HA snapshot.
 */
export type StateSkeleton = {
  zones: Array<{
    id: string;
    name: string;
    special: string | null;
    counts: Record<string, number>;
    entityIds: string[];
  }>;
  entities: Array<{
    entity_id: string;
    domain: string;
    name: string;
    area_id: string;
    device_id: string | null;
    isIllumination: boolean;
  }>;
  totals: Record<string, number>;
  lighting: DashboardState["lighting"];
};

export function stateSkeleton(state: DashboardState): StateSkeleton {
  return {
    zones: state.zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      special: zone.special ?? null,
      counts: zone.counts,
      entityIds: zone.entities.map((entity) => entity.entity_id),
    })),
    entities: [...state.entities]
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
      .map((entity) => ({
        entity_id: entity.entity_id,
        domain: entity.domain,
        name: entity.name,
        area_id: entity.area_id,
        device_id: entity.device_id ?? null,
        isIllumination: Boolean(entity.isIllumination),
      })),
    totals: state.totals,
    lighting: state.lighting,
  };
}
