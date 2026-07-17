import type { DashboardEntity, EntityRegistryEntry, HaDomain, HaState } from "../types";
import type { RegistryIndex, RegistrySnapshot } from "./registry";
import { areaSensorBindingIds } from "./registry";

export const DEFAULT_CONTROL_DOMAINS: HaDomain[] = [
  "light",
  "switch",
  "climate",
  "fan",
  "cover",
  "humidifier",
  "sensor",
];

// Generic fallback patterns, used only when a configured pattern is invalid.
export const DEFAULT_ILLUMINATION_RE = /\b(neon|light|lights|lamp|lamps|led|strip|glow|fairy|sign|illumination)\b/i;
export const DEFAULT_SUPPORT_SWITCH_RE = /\bauto[-_ ]?update\b/i;

export const DEFAULT_LABELS = {
  illumination: "nova_illumination",
  hidden: "nova_hidden",
  environment: "nova_environment",
};

/**
 * How an entity is classified for the dashboard. Most of this is derived from
 * Home Assistant metadata (domain, device_class, area, labels); the id-based
 * sets are escape hatches for when HA metadata is missing or wrong.
 */
export type EntityProjectionOptions = {
  controlDomains: HaDomain[];
  illuminationPattern: RegExp;
  supportSwitchPattern: RegExp;
  illuminationLabels: string[];
  hiddenLabels: string[];
  environmentLabels: string[];
  forceIlluminationEntityIds: Set<string>;
  forceHiddenEntityIds: Set<string>;
  environmentIncludeEntityIds: Set<string>;
  environmentExcludeEntityIds: Set<string>;
};

export type EntityProjectionContext = {
  index: RegistryIndex;
  areaTemperatureBindingIds: Set<string>;
  areaHumidityBindingIds: Set<string>;
};

export function projectionContext(snapshot: RegistrySnapshot, index: RegistryIndex): EntityProjectionContext {
  const bindings = areaSensorBindingIds(snapshot);
  return {
    index,
    areaTemperatureBindingIds: bindings.temperature,
    areaHumidityBindingIds: bindings.humidity,
  };
}

export function safeRegex(pattern: string, fallback: RegExp): RegExp {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return fallback;
  }
}

export function domainOf(entityId: string, controlDomains: HaDomain[]): HaDomain | null {
  const domain = entityId.split(".")[0] as HaDomain;
  return controlDomains.includes(domain) ? domain : null;
}

export function friendlyName(state: HaState, registry?: EntityRegistryEntry): string {
  return (
    registry?.name ??
    registry?.original_name ??
    (state.attributes.friendly_name as string | undefined) ??
    state.entity_id
  );
}

// Entity registry `labels` are label ids (slugs). Resolve to a lowercase set of
// both ids and human names so matching works against either.
function entityLabelSet(registry: EntityRegistryEntry | undefined, context: EntityProjectionContext): Set<string> {
  const out = new Set<string>();
  for (const id of registry?.labels ?? []) {
    out.add(id.toLowerCase());
    const name = context.index.labelById.get(id)?.name;
    if (name) out.add(name.toLowerCase());
  }
  return out;
}

function hasAnyLabel(labels: Set<string>, wanted: string[]): boolean {
  return wanted.some((label) => labels.has(label.toLowerCase()));
}

type Classifiable = Pick<DashboardEntity, "domain" | "entity_id" | "name">;

export function isIlluminationSwitch(
  entity: Classifiable,
  labels: Set<string>,
  options: EntityProjectionOptions,
): boolean {
  if (entity.domain !== "switch") {
    return false;
  }
  if (options.forceIlluminationEntityIds.has(entity.entity_id)) {
    return true;
  }
  if (hasAnyLabel(labels, options.illuminationLabels)) {
    return true;
  }
  return options.illuminationPattern.test(`${entity.name} ${entity.entity_id.replaceAll("_", " ")}`);
}

export function isHiddenSwitch(
  entity: Classifiable,
  labels: Set<string>,
  options: EntityProjectionOptions,
): boolean {
  if (entity.domain !== "switch") {
    return false;
  }
  if (options.forceHiddenEntityIds.has(entity.entity_id)) {
    return true;
  }
  if (hasAnyLabel(labels, options.hiddenLabels)) {
    return true;
  }
  return options.supportSwitchPattern.test(`${entity.name} ${entity.entity_id.replaceAll("_", " ")}`);
}

/**
 * Whether a sensor should appear on the dashboard. Driven by HA metadata first:
 *   device_class temperature/humidity, AND one of
 *   - assigned to an area, or
 *   - bound as an area's temperature/humidity entity, or
 *   - carrying an environment label.
 * The include/exclude id sets are explicit overrides (the include set also
 * preserves the legacy `loungeSensorEntityIds` behaviour of force-showing).
 */
export function isDashboardSensor(
  state: HaState,
  areaId: string,
  labels: Set<string>,
  options: EntityProjectionOptions,
  context: EntityProjectionContext,
): boolean {
  if (options.environmentExcludeEntityIds.has(state.entity_id)) {
    return false;
  }
  if (options.environmentIncludeEntityIds.has(state.entity_id)) {
    return true;
  }

  const deviceClass = String(state.attributes.device_class ?? "").toLowerCase();
  if (deviceClass !== "temperature" && deviceClass !== "humidity") {
    return false;
  }

  return (
    (areaId !== "unassigned" && Boolean(areaId)) ||
    context.areaTemperatureBindingIds.has(state.entity_id) ||
    context.areaHumidityBindingIds.has(state.entity_id) ||
    hasAnyLabel(labels, options.environmentLabels)
  );
}

export type ProjectionResult = {
  entities: DashboardEntity[];
};

export function projectDashboardEntities(
  states: HaState[],
  context: EntityProjectionContext,
  options: EntityProjectionOptions,
): ProjectionResult {
  const entities = states.flatMap<DashboardEntity>((state) => {
    const domain = domainOf(state.entity_id, options.controlDomains);
    if (!domain) {
      return [];
    }

    const registry = context.index.entityById.get(state.entity_id);
    if (registry?.disabled_by || registry?.hidden_by) {
      return [];
    }

    const device = registry?.device_id ? context.index.deviceById.get(registry.device_id) : undefined;
    const areaId = registry?.area_id ?? device?.area_id ?? "unassigned";
    const name = friendlyName(state, registry);
    const labels = entityLabelSet(registry, context);

    // Sensors are only surfaced when they are recognised dashboard sensors.
    const claimedSensor = domain === "sensor" && isDashboardSensor(state, areaId, labels, options, context);
    if (domain === "sensor" && !claimedSensor) {
      return [];
    }

    // Drop entities HA only "restored" from storage (offline/unavailable), but
    // keep claimed environment sensors so flaky room sensors stay visible.
    const restoredDrop = state.state === "unavailable" && state.attributes?.restored === true;
    if (restoredDrop && !claimedSensor) {
      return [];
    }

    const base: DashboardEntity = {
      entity_id: state.entity_id,
      domain,
      state: state.state,
      name,
      area_id: areaId,
      device_id: registry?.device_id ?? undefined,
      labels: registry?.labels ?? [],
      attributes: state.attributes ?? {},
    };

    const dashboardEntity: DashboardEntity = {
      ...base,
      isIllumination: isIlluminationSwitch(base, labels, options),
    };

    if (isHiddenSwitch(dashboardEntity, labels, options)) {
      return [];
    }

    return [dashboardEntity];
  });

  return { entities };
}
