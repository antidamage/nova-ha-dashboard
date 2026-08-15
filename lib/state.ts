import type { DashboardConfig } from "./config-schema";
import type { DashboardEntity, DashboardState, DashboardZone, HaState } from "./types";
import { lightingBrightnessTargetSnapshot } from "./lighting-convergence";
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
import { normalizedOrbInfoPreferences } from "./orb-info/preferences";
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
  const entities = dedupeCloudTwins(projected, registry, config.homeAssistant.cloudTwinIdentifierPrefixes);
  return { config, states, registry, index, entities, warnings: [...registry.warnings], haHealth };
}

/**
 * Label lights that are still travelling toward a commanded brightness, and the
 * zones containing them, so a reading taken mid-fade is published as
 * transitional rather than as a result.
 *
 * Lights are meant to interpolate — that is the look. What must not happen is a
 * client writing a point on that curve into a control as though the move had
 * finished, which is how a zone slider ends up drifting or snapping to a value
 * nobody chose. Marking is per-entity because a zone's brightness is an average:
 * one slow fixture makes the whole zone's number provisional.
 */
export function markLightingTransitions(entities: DashboardEntity[], zones: DashboardZone[]) {
  const targets = lightingBrightnessTargetSnapshot();
  if (!Object.keys(targets).length) {
    return;
  }

  for (const entity of entities) {
    const targetPct = targets[entity.entity_id];
    // A light that has been turned off is not on its way anywhere.
    if (targetPct === undefined || entity.domain !== "light" || entity.state !== "on") {
      continue;
    }
    entity.brightnessTransition = { targetPct };
  }

  for (const zone of zones) {
    const memberTargets = zone.entities.flatMap((entity) =>
      entity.brightnessTransition ? [entity.brightnessTransition.targetPct] : [],
    );
    if (!memberTargets.length) {
      continue;
    }
    // Averaged the same way zoneBrightnessPct is, so a uniform zone command
    // reports exactly the percent that was commanded.
    zone.brightnessTransition = {
      targetPct: Math.round(memberTargets.reduce((sum, pct) => sum + pct, 0) / memberTargets.length),
    };
  }
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

  markLightingTransitions(entities, zones);

  const stored = withComputedWatchfacePreferences(await readDashboardPreferences());
  // Normalised here rather than on each client: the Apple TV reads its orb
  // readout config straight off this payload and has no /api/orb-info fetch.
  const preferences = { ...stored, orbInfo: normalizedOrbInfoPreferences(stored.orbInfo) };

  return {
    generatedAt: new Date().toISOString(),
    zones,
    entities,
    // Which optional capabilities this installation has actually configured.
    // The client uses it to decide whether a capability's zone exists at all,
    // so an unconfigured module costs nothing rather than rendering an empty
    // panel the operator cannot act on.
    activeModuleIds: moduleStatuses(context)
      .filter((status) => status.active)
      .map((status) => status.id),
    totals: countDomains(entities, controlDomains),
    lighting: config.dashboard.lighting,
    zoneEnvironmentFallbacks: ha.zoneEnvironmentFallbacks,
    router: buildRouterStatus(states, config),
    sun: buildSunStatus(states, config),
    weather: await buildWeatherStatus(states, warnings, config),
    preferences,
    climateControl: await climateControlState(),
    warnings,
    haHealth: context.haHealth,
  };
}

/** Module activation + unmet-requirement report for agent-led deployment (MCP). */
export async function dashboardModuleStatuses(): Promise<ModuleStatus[]> {
  return moduleStatuses(await loadModuleContext());
}
