import type { DashboardEntity, DashboardZone, HaDomain } from "../types";
import { isEntityOn, zoneBrightnessPct } from "../entity-semantics";
import type { RegistrySnapshot } from "./registry";

export function lightLayerEntities(entities: DashboardEntity[]): DashboardEntity[] {
  return entities.filter((entity) => entity.domain === "light" || entity.isIllumination);
}

export function countDomains(entities: DashboardEntity[], controlDomains: HaDomain[]): Record<HaDomain, number> {
  // Single pass instead of one filter per control domain. The classification
  // mirrors the per-domain rules above: illumination switches count as lights
  // rather than switches, and every other entity counts under its own domain.
  const counts = {} as Record<HaDomain, number>;
  for (const domain of controlDomains) {
    counts[domain] = 0;
  }
  for (const entity of entities) {
    if ("light" in counts && (entity.domain === "light" || entity.isIllumination)) {
      counts.light += 1;
    }
    if ("switch" in counts && entity.domain === "switch" && !entity.isIllumination) {
      counts.switch += 1;
    }
    if (entity.domain !== "light" && entity.domain !== "switch" && entity.domain in counts) {
      counts[entity.domain] += 1;
    }
  }
  return counts;
}

export function zoneFromEntities(
  id: string,
  name: string,
  entities: DashboardEntity[],
  controlDomains: HaDomain[],
): DashboardZone {
  return {
    id,
    name,
    entities,
    counts: countDomains(entities, controlDomains),
    isOn: entities.some(isEntityOn),
    brightnessPct: zoneBrightnessPct(entities),
  };
}

// Structural config the dashboard layers on top of HA's area structure. These
// are the things HA cannot express: which areas are organisational rather than
// rooms, and what the aggregate "Home" zone should leave out.
export type ZoneAssemblyOptions = {
  controlDomains: HaDomain[];
  /** Area names (lowercased) treated as climate-control groupings. */
  climateAreaNames: Set<string>;
  /** The id (or name) of the area that represents network/router devices. */
  networkZoneId: string;
  /** Entities excluded from the aggregate "Home" zone. */
  everythingExcludedEntityIds: Set<string>;
};

/**
 * Build the zone list from projected entities + HA areas, then layer on the
 * synthetic aggregate "Home" zone and an always-present Network zone.
 */
export function assembleZones(
  entities: DashboardEntity[],
  snapshot: RegistrySnapshot,
  options: ZoneAssemblyOptions,
): DashboardZone[] {
  const { controlDomains } = options;
  const areaById = new Map(snapshot.areas.map((area) => [area.id as string, area]));

  // Group entities by area once (preserving their order) so the per-area and
  // orphan-area passes below are lookups rather than full scans of `entities`.
  const entitiesByArea = new Map<string, DashboardEntity[]>();
  for (const entity of entities) {
    const list = entitiesByArea.get(entity.area_id);
    if (list) {
      list.push(entity);
    } else {
      entitiesByArea.set(entity.area_id, [entity]);
    }
  }

  const climateAreaIds = new Set(
    snapshot.areas
      .filter((area) => options.climateAreaNames.has(String(area.name).trim().toLowerCase()))
      .map((area) => area.id as string),
  );
  const networkAreaIds = new Set(
    snapshot.areas
      .filter(
        (area) =>
          String(area.name).trim().toLowerCase() === options.networkZoneId || area.id === options.networkZoneId,
      )
      .map((area) => area.id as string),
  );

  const zones = snapshot.areas
    .map((area) => {
      const zone = zoneFromEntities(
        area.id as string,
        area.name,
        entitiesByArea.get(area.id as string) ?? [],
        controlDomains,
      );
      if (area.temperature_entity_id || area.humidity_entity_id) {
        zone.environment = {
          temperatureEntityId: area.temperature_entity_id ?? null,
          humidityEntityId: area.humidity_entity_id ?? null,
        };
      }
      return zone;
    })
    .filter((zone) => zone.entities.length > 0);

  const unassigned = entitiesByArea.get("unassigned") ?? [];
  if (unassigned.length) {
    zones.push(zoneFromEntities("unassigned", "Unassigned", unassigned, controlDomains));
  }

  // Areas referenced by entities but missing from the registry (orphans).
  for (const [areaId, areaEntities] of entitiesByArea) {
    if (areaId !== "unassigned" && !areaById.has(areaId)) {
      zones.push(zoneFromEntities(areaId, areaId.replaceAll("_", " "), areaEntities, controlDomains));
    }
  }

  zones.sort((a, b) => a.name.localeCompare(b.name));

  if (!zones.some((zone) => zone.id === options.networkZoneId || zone.name.trim().toLowerCase() === options.networkZoneId)) {
    zones.push(zoneFromEntities(options.networkZoneId, "Network", [], controlDomains));
  }

  zones.unshift(
    zoneFromEntities(
      "everything",
      "Home",
      entities.filter(
        (entity) =>
          !options.everythingExcludedEntityIds.has(entity.entity_id) &&
          entity.domain !== "climate" &&
          !climateAreaIds.has(entity.area_id) &&
          !networkAreaIds.has(entity.area_id),
      ),
      controlDomains,
    ),
  );

  return zones;
}
