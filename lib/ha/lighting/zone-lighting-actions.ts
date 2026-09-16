// Light-layer on/off for one zone (setZoneLightingAction) or the whole house
// (setAllLightingAction), in adaptive or plain power mode.
import { splitEntitiesByIntensityThreshold } from "../../lighting-thresholds";
import { adaptiveLightMode } from "../../lighting-presets";
import { setHousePartyZonePower } from "../../house-party-coordinator";
import { buildDashboardState } from "../../state";
import { lightLayerEntities } from "../zones";
import { assertLatestCommandCurrent, callLightingService, callMany, setEntityPower } from "./commands";
import {
  addLightPresetToPayload,
  adaptiveCandlelightBrightnessPct,
  adaptiveCandlelightPreset,
  applyPinnedPreset,
  clampTurnOnBrightnessPct,
  normalizedSunState,
  splitLightsByPresetBrightness,
  supportsBrightness,
  uniqueDashboardEntities,
} from "./light-model";
import { rememberAdaptiveCandlelightZone } from "./adaptive";
import { trackLightingBrightnessTargets } from "./convergence";

export async function setZoneLightingAction(input: {
  zoneId: string;
  action: "on" | "off";
  mode?: "adaptive" | "power";
  entityIds?: string[];
  brightnessPct?: number;
  isCurrent?: () => boolean;
  signal?: AbortSignal;
  traceId?: string;
}) {
  const dashboard = await buildDashboardState();
  assertLatestCommandCurrent(input);
  const zone = dashboard.zones.find((candidate) => candidate.id === input.zoneId);

  if (!zone) {
    throw new Error(`Unknown zone: ${input.zoneId}`);
  }
  const targetIdsForPower = new Set(zone.entities.map((entity) => entity.entity_id));
  for (const candidate of dashboard.zones) {
    if (candidate.entities.some((entity) => targetIdsForPower.has(entity.entity_id))) {
      setHousePartyZonePower(candidate.id, input.action === "on");
    }
  }

  const entityIds = input.entityIds ? new Set(input.entityIds) : null;
  const targets = lightLayerEntities(zone.entities).filter((entity) => !entityIds || entityIds.has(entity.entity_id));

  if (!targets.length) {
    throw new Error(`Zone has no lighting entities: ${input.zoneId}`);
  }

  if (input.action === "off") {
    await callMany(targets.map((entity) => setEntityPower(entity, false, input)));
    assertLatestCommandCurrent(input);
    return buildDashboardState();
  }

  if (input.mode === "power") {
    await callMany(targets.map((entity) => setEntityPower(entity, true, input)));
    assertLatestCommandCurrent(input);
    return buildDashboardState();
  }

  const mode = adaptiveLightMode(dashboard.sun);
  const brightness = clampTurnOnBrightnessPct(input.brightnessPct, adaptiveCandlelightBrightnessPct(dashboard.sun));
  const preset = adaptiveCandlelightPreset(dashboard.sun);
  const lights = targets.filter((entity) => entity.domain === "light");
  const switches = targets.filter((entity) => entity.domain === "switch" && entity.isIllumination);
  const lightPlan = splitLightsByPresetBrightness(lights, dashboard.lighting, mode, brightness);
  const switchPlan = splitEntitiesByIntensityThreshold(switches, brightness, dashboard.lighting);

  await callMany([
    ...lightPlan.suppressed.map((entity) => setEntityPower(entity, false, input)),
    ...switchPlan.suppressed.map((entity) => setEntityPower(entity, false, input)),
    ...switchPlan.active.map((entity) => setEntityPower(entity, true, input)),
    ...lightPlan.active.map(({ entity, brightnessPct }) => {
      const payload: Record<string, unknown> = { entity_id: entity.entity_id };
      if (!applyPinnedPreset(entity, payload, dashboard.lighting, dashboard.sun)) {
        if (supportsBrightness(entity)) {
          payload.brightness_pct = brightnessPct;
        }
        addLightPresetToPayload(entity, payload, preset, dashboard.lighting, mode);
      }
      return callLightingService("light", "turn_on", payload, input);
    }),
  ]);
  assertLatestCommandCurrent(input);
  trackLightingBrightnessTargets(lightPlan.active, dashboard.lighting);

  await rememberAdaptiveCandlelightZone(input.zoneId, true, normalizedSunState(dashboard.sun));
  assertLatestCommandCurrent(input);

  return buildDashboardState();
}

export async function setAllLightingAction(input: {
  action: "on" | "off";
  mode?: "adaptive" | "power";
  entityIds?: string[];
  brightnessPct?: number;
  isCurrent?: () => boolean;
  signal?: AbortSignal;
  traceId?: string;
}) {
  const dashboard = await buildDashboardState();
  setHousePartyZonePower("*", input.action === "on");
  assertLatestCommandCurrent(input);
  const entityIds = input.entityIds ? new Set(input.entityIds) : null;
  const targets = uniqueDashboardEntities(lightLayerEntities(dashboard.entities))
    .filter((entity) => !entityIds || entityIds.has(entity.entity_id));

  if (!targets.length) {
    throw new Error("Dashboard has no lighting entities");
  }

  if (input.action === "off") {
    await callMany(targets.map((entity) => setEntityPower(entity, false, input)));
    assertLatestCommandCurrent(input);
    return buildDashboardState();
  }

  if (input.mode === "power") {
    await callMany(targets.map((entity) => setEntityPower(entity, true, input)));
    assertLatestCommandCurrent(input);
    return buildDashboardState();
  }

  const mode = adaptiveLightMode(dashboard.sun);
  const brightness = clampTurnOnBrightnessPct(input.brightnessPct, adaptiveCandlelightBrightnessPct(dashboard.sun));
  const preset = adaptiveCandlelightPreset(dashboard.sun);
  const lights = targets.filter((entity) => entity.domain === "light");
  const switches = targets.filter((entity) => entity.domain === "switch" && entity.isIllumination);
  const lightPlan = splitLightsByPresetBrightness(lights, dashboard.lighting, mode, brightness);
  const switchPlan = splitEntitiesByIntensityThreshold(switches, brightness, dashboard.lighting);

  await callMany([
    ...lightPlan.suppressed.map((entity) => setEntityPower(entity, false, input)),
    ...switchPlan.suppressed.map((entity) => setEntityPower(entity, false, input)),
    ...switchPlan.active.map((entity) => setEntityPower(entity, true, input)),
    ...lightPlan.active.map(({ entity, brightnessPct }) => {
      const payload: Record<string, unknown> = { entity_id: entity.entity_id };
      if (!applyPinnedPreset(entity, payload, dashboard.lighting, dashboard.sun)) {
        if (supportsBrightness(entity)) {
          payload.brightness_pct = brightnessPct;
        }
        addLightPresetToPayload(entity, payload, preset, dashboard.lighting, mode);
      }
      return callLightingService("light", "turn_on", payload, input);
    }),
  ]);
  assertLatestCommandCurrent(input);
  trackLightingBrightnessTargets(lightPlan.active, dashboard.lighting);

  return buildDashboardState();
}
