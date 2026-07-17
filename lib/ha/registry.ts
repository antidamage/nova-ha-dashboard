import {
  AreaRegistryEntry,
  DeviceRegistryEntry,
  EntityRegistryEntry,
  LabelRegistryEntry,
} from "../types";
import { haWs } from "./client";

// A point-in-time read of the Home Assistant registries. Areas always carry a
// resolved `id` (HA returns `area_id`; older payloads only had a name).
export type RegistrySnapshot = {
  areas: AreaRegistryEntry[];
  devices: DeviceRegistryEntry[];
  entities: EntityRegistryEntry[];
  labels: LabelRegistryEntry[];
  warnings: string[];
};

export type RegistryIndex = {
  entityById: Map<string, EntityRegistryEntry>;
  deviceById: Map<string, DeviceRegistryEntry>;
  areaById: Map<string, AreaRegistryEntry>;
  labelById: Map<string, LabelRegistryEntry>;
};

export function resolveAreaId(area: AreaRegistryEntry): string {
  return (area.id ?? area.area_id ?? area.name.toLowerCase().replaceAll(" ", "_")) as string;
}

export async function readRegistrySnapshot(): Promise<RegistrySnapshot> {
  const [areas, devices, entities, labels] = await Promise.allSettled([
    haWs<AreaRegistryEntry[]>("config/area_registry/list"),
    haWs<DeviceRegistryEntry[]>("config/device_registry/list"),
    haWs<EntityRegistryEntry[]>("config/entity_registry/list"),
    haWs<LabelRegistryEntry[]>("config/label_registry/list"),
  ]);

  // Labels are optional (older HA, or none defined) and must never produce a
  // warning — the dashboard works fine without them.
  const warnings = [areas, devices, entities]
    .filter((result) => result.status === "rejected")
    .map((result) => (result as PromiseRejectedResult).reason?.message ?? "Registry read failed");

  return {
    areas:
      areas.status === "fulfilled"
        ? areas.value.map((area) => ({ ...area, id: resolveAreaId(area) }))
        : [],
    devices: devices.status === "fulfilled" ? devices.value : [],
    entities: entities.status === "fulfilled" ? entities.value : [],
    labels: labels.status === "fulfilled" ? labels.value : [],
    warnings,
  };
}

export function indexRegistry(snapshot: RegistrySnapshot): RegistryIndex {
  return {
    entityById: new Map(snapshot.entities.map((entity) => [entity.entity_id, entity])),
    deviceById: new Map(snapshot.devices.map((device) => [device.id, device])),
    areaById: new Map(snapshot.areas.map((area) => [area.id as string, area])),
    labelById: new Map(snapshot.labels.map((label) => [label.label_id, label])),
  };
}

/**
 * The set of entity ids that any area has bound as its trusted temperature or
 * humidity reading via HA's native area sensor bindings. These are always
 * treated as dashboard environment sensors regardless of their own area.
 */
export function areaSensorBindingIds(snapshot: RegistrySnapshot): {
  temperature: Set<string>;
  humidity: Set<string>;
} {
  const temperature = new Set<string>();
  const humidity = new Set<string>();
  for (const area of snapshot.areas) {
    if (area.temperature_entity_id) temperature.add(area.temperature_entity_id);
    if (area.humidity_entity_id) humidity.add(area.humidity_entity_id);
  }
  return { temperature, humidity };
}
