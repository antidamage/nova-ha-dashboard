import type { DashboardConfig } from "./config-schema";
import type { DashboardState, HaState } from "./types";
import { haRest } from "./ha/client";
import { reconcileHaStates } from "./ha/health";
import { readDashboardConfig } from "./dashboard-config";
import { indexRegistry, readRegistrySnapshot } from "./ha/registry";
import {
  DEFAULT_ILLUMINATION_RE,
  DEFAULT_SUPPORT_SWITCH_RE,
  projectDashboardEntities,
  projectionContext,
  safeRegex,
  type EntityProjectionOptions,
} from "./ha/entities";
import { assembleZones, countDomains } from "./ha/zones";
import { dedupeCloudTwins } from "./ha/twins";
import { applyEntityTransforms, moduleStatuses } from "./modules/registry";
import type { ModuleStateContext, ModuleStatus } from "./modules/types";
import { buildRouterStatus } from "./modules/router/module";
import { buildSunStatus, buildWeatherStatus } from "./modules/weather/module";
import { readDashboardPreferences } from "./preferences";
import { withComputedWatchfacePreferences } from "./watchface-preferences";
import { climateControlState } from "./climate-control";

function entityProjectionOptions(config: DashboardConfig): EntityProjectionOptions {
  const ha = config.homeAssistant;
  const classification = ha.classification;
  return {
    controlDomains: ha.controlDomains,
    illuminationPattern: safeRegex(ha.illuminationNamePattern, DEFAULT_ILLUMINATION_RE),
    supportSwitchPattern: safeRegex(ha.supportSwitchPattern, DEFAULT_SUPPORT_SWITCH_RE),
    illuminationLabels: classification.illuminationLabels,
    hiddenLabels: classification.hiddenLabels,
    environmentLabels: classification.environmentLabels,
    forceIlluminationEntityIds: new Set(classification.forceIlluminationEntityIds),
    forceHiddenEntityIds: new Set(classification.forceHiddenEntityIds),
    // The legacy lounge sensor list stays an explicit force-include override
    // (unioned with the new environment override) so it keeps working during the
    // transition to HA-native area sensor bindings.
    environmentIncludeEntityIds: new Set([
      ...ha.loungeSensorEntityIds,
      ...classification.environmentSensorEntityIds,
    ]),
    environmentExcludeEntityIds: new Set(classification.environmentSensorExcludeEntityIds),
  };
}

/**
 * Build the full dashboard state from a live Home Assistant snapshot:
 *   1. project + classify entities (lib/ha/entities)
 *   2. let modules transform entities (e.g. climate temperature overrides)
 *   3. assemble zones (lib/ha/zones)
 *   4. let modules contribute their slices (router, weather, sun, ...)
 */
/**
 * Read HA once and project entities, producing the shared context modules need.
 * Used by both buildDashboardState and the MCP module-status report.
 */
async function loadModuleContext(): Promise<ModuleStateContext> {
  const config = await readDashboardConfig();
  const [rawStates, registry] = await Promise.all([haRest<HaState[]>("/api/states"), readRegistrySnapshot()]);
  // Hold last-known-good state through a transient HA mass-outage so every tile
  // doesn't flip to "unavailable" at once (see lib/ha/health.ts). Everything
  // downstream — projection, zones, the host/router tile — reads the reconciled
  // states, so the whole snapshot stays coherent during the blip.
  const { states, health: haHealth } = reconcileHaStates(rawStates);
  const index = indexRegistry(registry);
  const projection = projectionContext(registry, index);
  const { entities: projected } = projectDashboardEntities(states, projection, entityProjectionOptions(config));
  const entities = dedupeCloudTwins(projected, registry);
  return { config, states, registry, index, entities, warnings: [...registry.warnings], haHealth };
}

export async function buildDashboardState(): Promise<DashboardState> {
  const context = await loadModuleContext();
  const { config, states, registry, entities, warnings } = context;
  const ha = config.homeAssistant;
  const controlDomains = ha.controlDomains;

  applyEntityTransforms(context);

  const zones = assembleZones(entities, registry, {
    controlDomains,
    climateAreaNames: new Set(ha.climateAreaNames.map((name) => name.trim().toLowerCase())),
    networkZoneId: ha.networkZoneId,
    everythingExcludedEntityIds: new Set(ha.everythingExcludedEntityIds),
  });

  if (!entities.some((entity) => ["light", "switch", "climate"].includes(entity.domain))) {
    warnings.push("Home Assistant currently has no light, switch, or climate entities.");
  }

  const preferences = withComputedWatchfacePreferences(await readDashboardPreferences());

  return {
    generatedAt: new Date().toISOString(),
    zones,
    entities,
    totals: countDomains(entities, controlDomains),
    lighting: config.dashboard.lighting,
    router: buildRouterStatus(states, config),
    sun: buildSunStatus(states, config),
    weather: await buildWeatherStatus(states, warnings, config),
    preferences,
    climateControl: climateControlState(),
    warnings,
    haHealth: context.haHealth,
  };
}

/** Module activation + unmet-requirement report for agent-led deployment (MCP). */
export async function dashboardModuleStatuses(): Promise<ModuleStatus[]> {
  return moduleStatuses(await loadModuleContext());
}
