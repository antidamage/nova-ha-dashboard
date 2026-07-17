import type { DashboardEntity, DashboardLightingConfig, LightingIntensityThreshold } from "./types";

function clampIntensityPct(value: unknown) {
  const pct = Number(value);
  if (!Number.isFinite(pct)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(pct)));
}

function thresholdEntityIds(threshold: LightingIntensityThreshold) {
  return new Set(threshold.entityIds.map((entityId) => entityId.trim()).filter(Boolean));
}

export function intensityThresholdPctForEntity(
  entity: Pick<DashboardEntity, "entity_id">,
  lighting?: DashboardLightingConfig,
) {
  let thresholdPct: number | null = null;

  for (const threshold of lighting?.intensityThresholds ?? []) {
    if (!thresholdEntityIds(threshold).has(entity.entity_id)) {
      continue;
    }

    const candidate = clampIntensityPct(threshold.thresholdPct);
    thresholdPct = thresholdPct === null ? candidate : Math.max(thresholdPct, candidate);
  }

  return thresholdPct;
}

export function hasIntensityThreshold(
  entity: Pick<DashboardEntity, "entity_id">,
  lighting?: DashboardLightingConfig,
) {
  return intensityThresholdPctForEntity(entity, lighting) !== null;
}

export function isEntitySuppressedByIntensity(
  entity: Pick<DashboardEntity, "entity_id">,
  intensityPct: unknown,
  lighting?: DashboardLightingConfig,
) {
  const thresholdPct = intensityThresholdPctForEntity(entity, lighting);
  return thresholdPct !== null && clampIntensityPct(intensityPct) < thresholdPct;
}

export function splitEntitiesByIntensityThreshold<T extends Pick<DashboardEntity, "entity_id">>(
  entities: T[],
  intensityPct: unknown,
  lighting?: DashboardLightingConfig,
) {
  return entities.reduce(
    (groups, entity) => {
      if (isEntitySuppressedByIntensity(entity, intensityPct, lighting)) {
        groups.suppressed.push(entity);
      } else {
        groups.active.push(entity);
      }
      return groups;
    },
    { active: [] as T[], suppressed: [] as T[] },
  );
}
