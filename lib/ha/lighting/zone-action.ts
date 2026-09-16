// setZoneAction: a zone's on/off/brightness/colour/candlelight/white command.
import { callService } from "../client";
import { hasIntensityThreshold, splitEntitiesByIntensityThreshold } from "../../lighting-thresholds";
import { adaptiveLightMode } from "../../lighting-presets";
import {
  deferLightingForHouseParty,
  housePartyIgnoresBrightness,
  setHousePartyZonePower,
} from "../../house-party-coordinator";
import { buildDashboardState } from "../../state";
import { assertLatestCommandCurrent, callLightingService, callMany, setEntityPower } from "./commands";
import {
  addLightPresetToPayload,
  adaptiveCandlelightBrightnessPct,
  adaptiveCandlelightPreset,
  applyPinnedPreset,
  clampTurnOnBrightnessPct,
  isSupportSwitch,
  normalizedSunState,
  splitLightsByPresetBrightness,
  supportsBrightness,
  supportsColor,
  uniqueDashboardEntities,
} from "./light-model";
import { acknowledgeAdaptiveSunStateForEntities, rememberAdaptiveCandlelightZone } from "./adaptive";
import { trackLightingBrightnessTargets } from "./convergence";

export async function setZoneAction(input: {
  zoneId: string;
  action: "on" | "off" | "brightness" | "color" | "candlelight" | "white";
  brightnessPct?: number;
  isCurrent?: () => boolean;
  rgb?: [number, number, number];
  signal?: AbortSignal;
  traceId?: string;
  housePartyBypass?: boolean;
}) {
  const dashboard = await buildDashboardState();
  assertLatestCommandCurrent(input);
  const zone = dashboard.zones.find((candidate) => candidate.id === input.zoneId);

  if (!zone) {
    throw new Error(`Unknown zone: ${input.zoneId}`);
  }

  const isEffectiveOff = input.action === "off"
    || (input.action === "brightness" && Math.round(input.brightnessPct ?? 0) === 0);
  if (input.action === "on" || isEffectiveOff) {
    const targetIds = new Set(zone.entities.map((entity) => entity.entity_id));
    for (const candidate of dashboard.zones) {
      if (candidate.entities.some((entity) => targetIds.has(entity.entity_id))) {
        setHousePartyZonePower(candidate.id, input.action === "on");
      }
    }
  }
  if (!input.housePartyBypass && !isEffectiveOff && input.action !== "on") {
    const deferredInput = {
      zoneId: input.zoneId,
      action: input.action,
      brightnessPct: input.brightnessPct,
      rgb: input.rgb,
      traceId: input.traceId,
      housePartyBypass: true,
    };
    const deferred = deferLightingForHouseParty(`zone:${input.zoneId}`, async () => {
      await setZoneAction(deferredInput);
    });
    const applyBrightnessNow = input.action === "brightness" && housePartyIgnoresBrightness();
    if (deferred && !applyBrightnessNow) {
      return dashboard;
    }
  }

  const lights = zone.entities.filter((entity) => entity.domain === "light");
  const switches = zone.entities.filter((entity) => entity.domain === "switch" && !isSupportSwitch(entity));
  const illuminationSwitches = switches.filter((entity) => entity.isIllumination);
  const thresholdSwitches = switches.filter((entity) => hasIntensityThreshold(entity, dashboard.lighting));
  const climates = zone.entities.filter((entity) => entity.domain === "climate");

  if (climates.length) {
    console.info("[nova-dashboard] climate zone action", {
      action: input.action,
      climates: climates.map((entity) => ({
        attributes: entity.attributes,
        entity_id: entity.entity_id,
        name: entity.name,
        state: entity.state,
      })),
      traceId: input.traceId,
      zoneId: input.zoneId,
    });
  }

  if (input.action === "off") {
    await callMany([
      ...lights.map((entity) => callLightingService("light", "turn_off", { entity_id: entity.entity_id }, input)),
      ...switches.map((entity) => callLightingService("switch", "turn_off", { entity_id: entity.entity_id }, input)),
      ...climates.map((entity) => callService("climate", "turn_off", { entity_id: entity.entity_id }, { signal: input.signal })),
    ]);
    assertLatestCommandCurrent(input);
    return buildDashboardState();
  }

  if (input.action === "brightness") {
    const brightness = Math.max(0, Math.min(100, Math.round(input.brightnessPct ?? 0)));
    const brightnessSwitches = uniqueDashboardEntities([...illuminationSwitches, ...thresholdSwitches]);
    if (brightness === 0) {
      await callMany([
        ...lights.map((entity) => callLightingService("light", "turn_off", { entity_id: entity.entity_id }, input)),
        ...brightnessSwitches.map((entity) => setEntityPower(entity, false, input)),
      ]);
      assertLatestCommandCurrent(input);
      return buildDashboardState();
    }

    const lightPlan = splitEntitiesByIntensityThreshold(lights, brightness, dashboard.lighting);
    const switchPlan = splitEntitiesByIntensityThreshold(brightnessSwitches, brightness, dashboard.lighting);
    await callMany([
      ...lightPlan.suppressed.map((entity) => setEntityPower(entity, false, input)),
      ...switchPlan.suppressed.map((entity) => setEntityPower(entity, false, input)),
      ...switchPlan.active.map((entity) => setEntityPower(entity, true, input)),
      ...lightPlan.active.map((entity) => {
        const payload: Record<string, unknown> = { entity_id: entity.entity_id };
        if (!applyPinnedPreset(entity, payload, dashboard.lighting, dashboard.sun) && supportsBrightness(entity)) {
          payload.brightness_pct = brightness;
        }
        return callLightingService("light", "turn_on", payload, input);
      }),
    ]);
    assertLatestCommandCurrent(input);

    // The brightness just entered is the zone's intent for this sun state, so
    // the pending sunrise/sunset transition must not overwrite it, and the
    // lights must actually arrive at it rather than wherever a fade stopped.
    await acknowledgeAdaptiveSunStateForEntities(dashboard, lightPlan.active);
    assertLatestCommandCurrent(input);
    trackLightingBrightnessTargets(
      lightPlan.active.map((entity) => ({ entity, brightnessPct: brightness })),
      dashboard.lighting,
    );

    return buildDashboardState();
  }

  if (input.action === "color") {
    const brightnessBase = input.brightnessPct ?? zone.brightnessPct;
    const brightness = Math.max(1, Math.min(100, Math.round(brightnessBase || 100)));
    const rgb = input.rgb ?? [255, 180, 90];
    const lightPlan = splitEntitiesByIntensityThreshold(lights, brightness, dashboard.lighting);
    const switchPlan = splitEntitiesByIntensityThreshold(illuminationSwitches, brightness, dashboard.lighting);
    await callMany([
      ...lightPlan.suppressed.map((entity) => setEntityPower(entity, false, input)),
      ...switchPlan.suppressed.map((entity) => setEntityPower(entity, false, input)),
      ...switchPlan.active.map((entity) => setEntityPower(entity, true, input)),
      ...lightPlan.active.map((entity) => {
        const payload: Record<string, unknown> = { entity_id: entity.entity_id };
        if (!applyPinnedPreset(entity, payload, dashboard.lighting, dashboard.sun)) {
          if (supportsColor(entity)) {
            payload.rgb_color = rgb;
          }
          if (supportsBrightness(entity)) {
            payload.brightness_pct = brightness;
          }
        }
        return callLightingService("light", "turn_on", payload, input);
      }),
    ]);
    assertLatestCommandCurrent(input);
    trackLightingBrightnessTargets(
      lightPlan.active.map((entity) => ({ entity, brightnessPct: brightness })),
      dashboard.lighting,
    );
    await rememberAdaptiveCandlelightZone(input.zoneId, false, normalizedSunState(dashboard.sun));
    // Overlapping zones (notably aggregate "Home") keep their own adaptive
    // memory, so their pending transition would otherwise repaint this colour.
    await acknowledgeAdaptiveSunStateForEntities(dashboard, lightPlan.active);
    assertLatestCommandCurrent(input);
    return buildDashboardState();
  }

  const mode = adaptiveLightMode(dashboard.sun);
  const preset = input.action === "white" ? "white" : adaptiveCandlelightPreset(dashboard.sun);
  const brightness = input.action === "white"
    ? 100
    : clampTurnOnBrightnessPct(input.brightnessPct, adaptiveCandlelightBrightnessPct(dashboard.sun));
  const whiteLightPlan = input.action === "white"
    ? splitEntitiesByIntensityThreshold(lights, brightness, dashboard.lighting)
    : null;
  const lightPlan = input.action === "white"
    ? {
        active: (whiteLightPlan?.active ?? []).map((entity) => ({
          entity,
          brightnessPct: brightness,
        })),
        suppressed: whiteLightPlan?.suppressed ?? [],
      }
    : splitLightsByPresetBrightness(lights, dashboard.lighting, mode, brightness);
  const illuminationSwitchPlan = splitEntitiesByIntensityThreshold(illuminationSwitches, brightness, dashboard.lighting);
  const regularSwitchPlan = splitEntitiesByIntensityThreshold(
    switches.filter((entity) => !entity.isIllumination),
    brightness,
    dashboard.lighting,
  );

  await callMany([
    ...lightPlan.suppressed.map((entity) => setEntityPower(entity, false, input)),
    ...illuminationSwitchPlan.suppressed.map((entity) => setEntityPower(entity, false, input)),
    ...regularSwitchPlan.suppressed.map((entity) => setEntityPower(entity, false, input)),
    ...illuminationSwitchPlan.active.map((entity) => setEntityPower(entity, true, input)),
    ...regularSwitchPlan.active.map((entity) => (input.action === "on" ? setEntityPower(entity, true, input) : Promise.resolve())),
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

  if (input.action === "on" || input.action === "candlelight") {
    await rememberAdaptiveCandlelightZone(input.zoneId, true, normalizedSunState(dashboard.sun));
  } else if (input.action === "white") {
    await rememberAdaptiveCandlelightZone(input.zoneId, false, normalizedSunState(dashboard.sun));
  }
  assertLatestCommandCurrent(input);

  return buildDashboardState();
}
