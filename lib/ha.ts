import {
  DashboardEntity,
  DashboardState,
  DashboardZone,
  HaDomain,
  SunStatus,
} from "./types";
import { mergeDashboardPreferences } from "./preferences";
import {
  hasIntensityThreshold,
  intensityThresholdPctForEntity,
  isEntitySuppressedByIntensity,
  splitEntitiesByIntensityThreshold,
} from "./lighting-thresholds";
import {
  adaptiveLightBrightnessPctForEntity,
  adaptiveLightColorTemperatureKelvinForEntity,
  adaptiveLightMode,
  adaptiveLightPreset,
  defaultAdaptiveLightBrightnessPct,
  isPinnedLightEntity,
  DEFAULT_DAYTIME_LIGHT_BRIGHTNESS_PCT,
  type AdaptiveLightMode,
  type LightPreset,
} from "./lighting-presets";
import { callService, haRest, subscribeHaStateChanges } from "./ha/client";
import { SupersededLightingCommandError } from "./lighting-command-coordinator";
import {
  brightnessPctFromAttribute,
  claimLightingBrightnessTargets,
  lightingBrightnessTargetEntityIds,
  lightingBrightnessTargetFor,
  needsBrightnessConvergence,
  releaseLightingBrightnessTarget,
  releaseLightingBrightnessTargets,
  LIGHTING_CONVERGENCE_RETRY_DELAYS_MS,
} from "./lighting-convergence";
import { isEntityOn } from "./entity-semantics";
import { DEFAULT_SUPPORT_SWITCH_RE } from "./ha/entities";
import { lightLayerEntities } from "./ha/zones";
import { buildDashboardState } from "./state";
import {
  deferLightingForHouseParty,
  hasActiveHousePartySession,
  housePartyIgnoresBrightness,
  isHousePartyZoneSuppressed,
  setHousePartyZonePower,
} from "./house-party-coordinator";
import { housePartyNativeTransitionSeconds, randomHueOffsetRgb } from "./house-party";
import { PHONOSCOPE_HUE_OFFSET_EFFECT } from "./phonoscope-drivers";
import { PHONOSCOPE_PICTURE_EFFECTS } from "./phonoscope-effects";

const PHONOSCOPE_HUE_OFFSET_DEFAULT = PHONOSCOPE_PICTURE_EFFECTS
  .find((effect) => effect.id === PHONOSCOPE_HUE_OFFSET_EFFECT)?.default ?? 0;

// lib/ha is the back-compat barrel + the lighting/entity command surface. The
// state projection, registry, router, weather and climate logic now live in
// focused modules and are re-exported here so existing imports keep working.
export { buildDashboardState, callService, haRest, subscribeHaStateChanges };
export {
  buildRouterStatusOnly,
  normalizeDataRateToMegabytesPerSecond,
  selectRouterRateEntityId,
} from "./modules/router/module";
export { warmWeatherCache } from "./modules/weather/module";

// Default "hidden switch" pattern for the lighting action path; the entity
// projection uses the configured pattern (see lib/ha/entities).
const SUPPORT_SWITCH_RE = DEFAULT_SUPPORT_SWITCH_RE;
const WARM_WHITE_KELVIN = 3000;

type AdaptiveSunState = "above_horizon" | "below_horizon";

type LatestCommandControl = {
  isCurrent?: () => boolean;
  signal?: AbortSignal;
};

function assertLatestCommandCurrent(control?: LatestCommandControl) {
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

function callLightingService(
  domain: "light" | "switch",
  service: string,
  serviceData: Record<string, unknown>,
  control?: LatestCommandControl,
) {
  assertLatestCommandCurrent(control);
  return callService(domain, service, serviceData, {
    latestKey: latestLightingServiceKey(domain, serviceData),
    signal: control?.signal,
  });
}

// Hidden/support switches are removed during entity projection; this lighting
// action helper guards again defensively using the generic pattern.
function isSupportSwitch(entity: Pick<DashboardEntity, "domain" | "entity_id" | "name">, pattern = SUPPORT_SWITCH_RE) {
  if (entity.domain !== "switch") {
    return false;
  }

  return pattern.test(`${entity.name} ${entity.entity_id.replaceAll("_", " ")}`);
}

function supportedModes(entity: DashboardEntity) {
  const modes = entity.attributes.supported_color_modes;
  return Array.isArray(modes) ? modes.map(String) : [];
}

function supportsBrightness(entity: DashboardEntity) {
  const modes = supportedModes(entity);
  return modes.some((mode) => ["brightness", "color_temp", "hs", "rgb", "rgbw", "rgbww", "xy"].includes(mode));
}

function supportsColor(entity: DashboardEntity) {
  const modes = supportedModes(entity);
  return modes.some((mode) => ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(mode));
}

function numericAttribute(entity: DashboardEntity, name: string) {
  const value = Number(entity.attributes[name]);
  return Number.isFinite(value) ? value : null;
}

function miredToKelvin(value: number) {
  return Math.round(1_000_000 / value);
}

function colorTempKelvinRange(entity: DashboardEntity) {
  const maxMireds = numericAttribute(entity, "max_mireds");
  const minMireds = numericAttribute(entity, "min_mireds");
  const minKelvin = numericAttribute(entity, "min_color_temp_kelvin") ?? (maxMireds ? miredToKelvin(maxMireds) : null);
  const maxKelvin = numericAttribute(entity, "max_color_temp_kelvin") ?? (minMireds ? miredToKelvin(minMireds) : null);

  return { minKelvin, maxKelvin };
}

function supportsColorTemp(entity: DashboardEntity) {
  const modes = supportedModes(entity);
  const range = colorTempKelvinRange(entity);
  return modes.includes("color_temp") || range.minKelvin !== null || range.maxKelvin !== null;
}

function clampKelvinForEntity(entity: DashboardEntity, kelvin: number) {
  const range = colorTempKelvinRange(entity);
  return Math.max(range.minKelvin ?? kelvin, Math.min(range.maxKelvin ?? kelvin, kelvin));
}

function presetColorTempKelvin(entity: DashboardEntity, preset: LightPreset) {
  if (preset === "candlelight") {
    return colorTempKelvinRange(entity).minKelvin ?? 1800;
  }
  if (preset === "warm-white") {
    return clampKelvinForEntity(entity, WARM_WHITE_KELVIN);
  }
  return colorTempKelvinRange(entity).maxKelvin ?? 6500;
}

function presetRgb(preset: LightPreset): [number, number, number] {
  if (preset === "candlelight") {
    return [255, 147, 41];
  }
  if (preset === "warm-white") {
    return [255, 214, 170];
  }
  return [255, 255, 255];
}

function normalizedSunState(sun?: SunStatus | null): AdaptiveSunState | null {
  return sun?.state === "above_horizon" || sun?.state === "below_horizon" ? sun.state : null;
}

function adaptiveCandlelightPreset(sun?: SunStatus | null): LightPreset {
  return adaptiveLightPreset(sun);
}

function adaptiveCandlelightBrightnessPct(sun?: SunStatus | null) {
  return defaultAdaptiveLightBrightnessPct(sun);
}

function addLightPresetToPayload(
  entity: DashboardEntity,
  payload: Record<string, unknown>,
  preset: LightPreset,
  lighting: DashboardState["lighting"],
  mode?: AdaptiveLightMode,
) {
  const colorTemperatureOverrideKelvin =
    preset === "white" ? null : adaptiveLightColorTemperatureKelvinForEntity(entity, lighting, mode);
  if (colorTemperatureOverrideKelvin !== null) {
    if (supportsColorTemp(entity)) {
      payload.color_temp_kelvin = clampKelvinForEntity(entity, colorTemperatureOverrideKelvin);
    } else if (supportsColor(entity)) {
      payload.rgb_color = [255, 255, 255];
    }
    return;
  }

  if (supportsColorTemp(entity)) {
    payload.color_temp_kelvin = presetColorTempKelvin(entity, preset);
  } else if (supportsColor(entity)) {
    payload.rgb_color = presetRgb(preset);
  }
}

/**
 * If the entity is a pinned light, fill `payload` with its fixed preset
 * (brightness + warm colour) and return true so callers skip whatever
 * brightness/colour the zone command would otherwise apply. This is how a
 * fixture like the conservatory stays warm-white at full brightness no matter
 * how the rest of the room is set, and how it gets reapplied on every edit.
 */
function applyPinnedPreset(
  entity: DashboardEntity,
  payload: Record<string, unknown>,
  lighting: DashboardState["lighting"],
  sun?: SunStatus | null,
): boolean {
  if (!isPinnedLightEntity(entity, lighting)) {
    return false;
  }

  const mode = adaptiveLightMode(sun);
  if (supportsBrightness(entity)) {
    payload.brightness_pct = adaptiveLightBrightnessPctForEntity(
      entity,
      lighting,
      mode,
      DEFAULT_DAYTIME_LIGHT_BRIGHTNESS_PCT,
    );
  }

  const overrideKelvin = adaptiveLightColorTemperatureKelvinForEntity(entity, lighting, mode);
  if (overrideKelvin !== null) {
    if (supportsColorTemp(entity)) {
      payload.color_temp_kelvin = clampKelvinForEntity(entity, overrideKelvin);
    } else if (supportsColor(entity)) {
      payload.rgb_color = [255, 255, 255];
    }
  } else {
    // Pinned without an explicit colour override defaults to warm white.
    addLightPresetToPayload(entity, payload, "warm-white", lighting, mode);
  }

  return true;
}

async function rememberAdaptiveCandlelightZone(zoneId: string, enabled: boolean, sunState: AdaptiveSunState | null) {
  await mergeDashboardPreferences({
    lighting: {
      adaptiveCandlelightZones: {
        [zoneId]: {
          enabled,
          lastSunState: enabled ? (sunState ?? undefined) : undefined,
          updatedAt: new Date().toISOString(),
        },
      },
    },
  });
}

/**
 * Mark every adaptive zone containing these entities as already settled for the
 * current sun state.
 *
 * The scheduled transition (`applyAdaptiveCandlelightTransitions`) fires when a
 * zone's remembered sun state differs from the live one, and it re-drives the
 * zone's on-lights to the adaptive brightness for that state — 100% by day.
 * Overnight it has nothing to act on, so the pending sunrise transition sits
 * there until lights come on, and then the next 60s tick overwrites whatever
 * brightness was just chosen. Stamping the sun state when the user sets a
 * brightness or colour themselves is what consumes that pending transition: the
 * value they just entered *is* the current intent for this sun state, and the
 * next real horizon crossing still transitions normally.
 *
 * Every overlapping zone is stamped, not just the commanded one, because the
 * aggregate "Home" zone contains the same lights — leaving its transition
 * pending would let it override a single room's edit.
 */
async function acknowledgeAdaptiveSunStateForEntities(
  dashboard: DashboardState,
  entities: DashboardEntity[],
) {
  const sunState = normalizedSunState(dashboard.sun);
  if (!sunState) {
    return;
  }

  const adaptiveZones = dashboard.preferences.lighting?.adaptiveCandlelightZones ?? {};
  const entityIds = new Set(entities.map((entity) => entity.entity_id));

  for (const zone of dashboard.zones) {
    const preference = adaptiveZones[zone.id];
    // A zone that is not following adaptive candlelight, or is already stamped
    // with the live sun state, has no pending transition to consume.
    if (!preference?.enabled || preference.lastSunState === sunState) {
      continue;
    }
    if (!zone.entities.some((entity) => entityIds.has(entity.entity_id))) {
      continue;
    }

    await rememberAdaptiveCandlelightZone(zone.id, true, sunState);
  }
}

/**
 * Record what brightness these lights were just sent to. That record does two
 * jobs: it publishes their in-flight readings as transitional (see
 * `markLightingTransitions` in lib/state) so no client mistakes a point on the
 * fade for the result, and it drives the bounded follow-up that re-sends the
 * value to any light that stopped short.
 *
 * Pinned fixtures are excluded — their own scheduled pass owns their look.
 */
function trackLightingBrightnessTargets(
  targets: Array<{ entity: DashboardEntity; brightnessPct: number }>,
  lighting: DashboardState["lighting"],
) {
  scheduleLightingBrightnessConvergence(
    claimLightingBrightnessTargets(
      targets
        .filter(({ entity }) => supportsBrightness(entity) && !isPinnedLightEntity(entity, lighting))
        .map(({ entity, brightnessPct }) => ({ entityId: entity.entity_id, brightnessPct })),
    ),
  );
}

async function callMany(tasks: Promise<unknown>[]) {
  const results = await Promise.allSettled(tasks);
  const failures = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
  if (failures.length && failures.length === results.length) {
    throw failures[0].reason;
  }
}

function uniqueDashboardEntities<T extends DashboardEntity>(entities: T[]) {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    if (seen.has(entity.entity_id)) {
      return false;
    }
    seen.add(entity.entity_id);
    return true;
  });
}

function clampTurnOnBrightnessPct(value: unknown, fallback: number) {
  const pct = Number(value);
  if (!Number.isFinite(pct) || pct <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(100, Math.round(pct)));
}

function splitLightsByPresetBrightness<T extends DashboardEntity>(
  lights: T[],
  lighting: DashboardState["lighting"],
  mode: AdaptiveLightMode,
  fallbackBrightnessPct: number,
) {
  return lights.reduce(
    (groups, entity) => {
      const brightnessPct = adaptiveLightBrightnessPctForEntity(entity, lighting, mode, fallbackBrightnessPct);
      if (isEntitySuppressedByIntensity(entity, brightnessPct, lighting)) {
        groups.suppressed.push(entity);
      } else {
        groups.active.push({ entity, brightnessPct });
      }
      return groups;
    },
    { active: [] as Array<{ entity: T; brightnessPct: number }>, suppressed: [] as T[] },
  );
}

function setEntityPower(entity: DashboardEntity, on: boolean, control?: LatestCommandControl) {
  if (entity.domain !== "light" && entity.domain !== "switch") {
    return Promise.resolve();
  }

  return callLightingService(entity.domain, on ? "turn_on" : "turn_off", { entity_id: entity.entity_id }, control);
}

function zonesForThresholdEntity(dashboard: DashboardState, entityId: string) {
  const zones = dashboard.zones.filter((zone) => zone.entities.some((entity) => entity.entity_id === entityId));
  const specificZones = zones.filter((zone) => zone.id !== "everything" && !zone.special);
  return specificZones.length ? specificZones : zones;
}

function zoneHasActiveLighting(zone: DashboardZone) {
  return lightLayerEntities(zone.entities).some(isEntityOn);
}

function targetZoneForThresholdEntity(dashboard: DashboardState, entityId: string) {
  const zones = zonesForThresholdEntity(dashboard, entityId);
  return zones.find(zoneHasActiveLighting) ?? zones[0] ?? null;
}

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

export type HousePartyLightingFrame = {
  rgb: [number, number, number];
  brightnessPct?: number;
  cloudBrightnessPct?: number;
  transitionSeconds?: number;
  /** Degrees of random hue jitter per light, resolved by the renderer. */
  hueOffsetDegrees?: number;
};

const HOUSE_PARTY_STATE_CACHE_MS = 500;
const HOUSE_PARTY_CLOUD_FRAME_INTERVAL_MS = 200;
const HOUSE_PARTY_DEVICE_CALL_TIMEOUT_MS = 900;
let housePartyStateCache: { expiresAt: number; state: DashboardState } | null = null;
let lastHousePartyCloudFrameAt = 0;
const lastHousePartyNativeFrameAt = new Map<string, number>();

type HousePartyLightSnapshot = {
  entityId: string;
  serviceData: Record<string, unknown>;
};

function finiteNumberArray(value: unknown, length: number) {
  if (!Array.isArray(value) || value.length !== length) return null;
  const numbers = value.map(Number);
  return numbers.every(Number.isFinite) ? numbers : null;
}

function callHousePartyLight(
  entityId: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HOUSE_PARTY_DEVICE_CALL_TIMEOUT_MS);
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abort, { once: true });
  return callService("light", "turn_on", payload, {
    latestKey: `lighting:house-party:${entityId}`,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  });
}

/**
 * Captures only the colour-capable, currently-on lights that House Party is
 * allowed to animate. On/off-only lights are deliberately absent, so neither
 * the party nor its teardown touches devices such as the lounge neons.
 */
export async function captureHousePartyLightingRestore() {
  const dashboard = await buildDashboardState();
  const enabledZones = dashboard.preferences.lighting?.housePartyZones ?? {};
  const snapshots = new Map<string, HousePartyLightSnapshot>();

  for (const zone of dashboard.zones) {
    if (!enabledZones[zone.id]?.enabled) continue;
    for (const entity of zone.entities) {
      if (
        entity.domain !== "light"
        || entity.state !== "on"
        || !supportsColor(entity)
        || snapshots.has(entity.entity_id)
      ) continue;

      const serviceData: Record<string, unknown> = { entity_id: entity.entity_id };
      const brightness = numericAttribute(entity, "brightness");
      if (brightness !== null) serviceData.brightness = Math.max(1, Math.min(255, Math.round(brightness)));

      const colorMode = String(entity.attributes.color_mode ?? "");
      const colorAttribute = colorMode === "color_temp"
        ? (numericAttribute(entity, "color_temp_kelvin") !== null ? "color_temp_kelvin" : "color_temp")
        : colorMode === "hs" ? "hs_color"
        : colorMode === "xy" ? "xy_color"
        : colorMode === "rgbw" ? "rgbw_color"
        : colorMode === "rgbww" ? "rgbww_color"
        : "rgb_color";
      const colorLength = colorAttribute === "hs_color" || colorAttribute === "xy_color" ? 2
        : colorAttribute === "rgbw_color" ? 4
        : colorAttribute === "rgbww_color" ? 5
        : colorAttribute === "rgb_color" ? 3
        : 0;
      if (colorLength) {
        const color = finiteNumberArray(entity.attributes[colorAttribute], colorLength);
        if (color) serviceData[colorAttribute] = color;
      } else {
        const temperature = numericAttribute(entity, colorAttribute);
        if (temperature !== null) serviceData[colorAttribute] = Math.round(temperature);
      }
      snapshots.set(entity.entity_id, { entityId: entity.entity_id, serviceData });
    }
  }

  return async () => {
    await Promise.all(
      [...snapshots.values()].map(({ entityId, serviceData }) =>
        callService("light", "turn_on", serviceData, {
          latestKey: `lighting:${entityId}`,
        })),
    );
  };
}

export async function applyHousePartyLightingFrame(
  frame: HousePartyLightingFrame,
  signal?: AbortSignal,
) {
  const now = Date.now();
  const dashboard = housePartyStateCache && housePartyStateCache.expiresAt > now
    ? housePartyStateCache.state
    : await buildDashboardState();
  housePartyStateCache = { expiresAt: now + HOUSE_PARTY_STATE_CACHE_MS, state: dashboard };
  const enabledZones = dashboard.preferences.lighting?.housePartyZones ?? {};
  // The household master switch. Per-zone opt-in still applies on top; this is
  // the single control that stops the visualiser touching any light at all.
  if (dashboard.preferences.phonoscope?.houseParty?.enabled === false) {
    return { affectedZoneIds: [] as string[], entityIds: [] as string[], state: dashboard };
  }
  // `__hueOffset` arrives resolved on the frame, because only the renderer holds
  // the spectrum a bass or energy driver reads. An older renderer that does not
  // send it falls back to the effect's declared default.
  const randomHueOffset = Math.max(0, Math.min(180,
    Number.isFinite(Number(frame.hueOffsetDegrees))
      ? Number(frame.hueOffsetDegrees)
      : PHONOSCOPE_HUE_OFFSET_DEFAULT));
  const entityIds = new Set<string>();
  const affectedZoneIds: string[] = [];

  for (const zone of dashboard.zones) {
    if (!enabledZones[zone.id]?.enabled || isHousePartyZoneSuppressed(zone.id)) continue;
    let affected = false;
    for (const entity of zone.entities) {
      if (
        entity.domain !== "light"
        || entity.state !== "on"
        || !supportsColor(entity)
        || ["unavailable", "unknown"].includes(entity.state)
      ) continue;
      entityIds.add(entity.entity_id);
      affected = true;
    }
    if (affected) affectedZoneIds.push(zone.id);
  }

  if (!entityIds.size) return { affectedZoneIds, entityIds: [] as string[], state: dashboard };
  const localEntityIds = [...entityIds].filter((entityId) => !entityId.startsWith("light.tuya_mobile_"));
  const cloudEntityIds = [...entityIds].filter((entityId) => entityId.startsWith("light.tuya_mobile_"));
  const calls: Promise<unknown>[] = [];
  for (const entityId of localEntityIds) {
    const localPayload: Record<string, unknown> = {
      entity_id: entityId,
      rgb_color: randomHueOffsetRgb(frame.rgb, randomHueOffset),
    };
    const entity = dashboard.entities.find((candidate) => candidate.entity_id === entityId);
    const transition = housePartyNativeTransitionSeconds(
      entity?.attributes.supported_features,
      frame.transitionSeconds,
    );
    if (transition !== undefined) {
      const earliestNextFrame = (lastHousePartyNativeFrameAt.get(entityId) ?? 0) + transition * 900;
      if (now < earliestNextFrame) continue;
      lastHousePartyNativeFrameAt.set(entityId, now);
      localPayload.transition = transition;
    }
    if (typeof frame.brightnessPct === "number") {
      localPayload.brightness_pct = Math.max(5, Math.min(100, Math.round(frame.brightnessPct)));
    }
    calls.push(callHousePartyLight(entityId, localPayload, signal));
  }
  if (cloudEntityIds.length && now - lastHousePartyCloudFrameAt >= HOUSE_PARTY_CLOUD_FRAME_INTERVAL_MS) {
    lastHousePartyCloudFrameAt = now;
    const cloudBrightness = frame.cloudBrightnessPct ?? frame.brightnessPct;
    for (const entityId of cloudEntityIds) {
      const cloudPayload: Record<string, unknown> = {
        entity_id: entityId,
        rgb_color: randomHueOffsetRgb(frame.rgb, randomHueOffset),
      };
      if (typeof cloudBrightness === "number") {
        cloudPayload.brightness_pct = Math.max(5, Math.min(100, Math.round(cloudBrightness)));
      }
      calls.push(callHousePartyLight(entityId, cloudPayload, signal));
    }
  }
  for (const call of calls) {
    void call.catch((error) => {
      if (!(error instanceof Error && error.name === "AbortError")) {
        console.warn("[nova-dashboard] House Party light update failed", error);
      }
    });
  }
  return { affectedZoneIds, entityIds: [...entityIds], state: dashboard };
}

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

/**
 * Check back on a commanded brightness and re-drive anything that did not get
 * there. Bulbs ease toward a target and occasionally stop short; without this
 * the dashboard shows what was asked for while the room sits at something else.
 *
 * Bounded on purpose — a fixed, short retry schedule that then forgets the
 * target — so it corrects a fade that missed without ever becoming a standing
 * override of a change made from Home Assistant, a wall switch, or voice.
 */
function scheduleLightingBrightnessConvergence(token: number, attempt = 0) {
  const delayMs = LIGHTING_CONVERGENCE_RETRY_DELAYS_MS[attempt];
  if (delayMs === undefined) {
    releaseLightingBrightnessTargets(token);
    return;
  }
  if (!lightingBrightnessTargetEntityIds(token).length) {
    return;
  }

  const timer = setTimeout(() => {
    void runLightingBrightnessConvergence(token, attempt);
  }, delayMs);
  timer.unref?.();
}

async function runLightingBrightnessConvergence(token: number, attempt: number) {
  const entityIds = lightingBrightnessTargetEntityIds(token);
  if (!entityIds.length) {
    return;
  }

  // A house party drives the lights on its own cadence; correcting toward an
  // older manual brightness mid-party would fight it.
  if (hasActiveHousePartySession()) {
    releaseLightingBrightnessTargets(token);
    return;
  }

  try {
    const dashboard = await buildDashboardState();
    const tasks: Promise<unknown>[] = [];

    for (const entityId of entityIds) {
      const targetPct = lightingBrightnessTargetFor(entityId, token);
      if (targetPct === null) {
        // A newer command owns this light now; its own follow-up applies.
        continue;
      }

      const entity = dashboard.entities.find((candidate) => candidate.entity_id === entityId);
      // Turned off, gone, or unavailable since the command: the target is void.
      if (!entity || entity.domain !== "light" || entity.state !== "on") {
        releaseLightingBrightnessTarget(entityId, token);
        continue;
      }

      const currentPct = brightnessPctFromAttribute(numericAttribute(entity, "brightness"));
      if (!needsBrightnessConvergence(currentPct, targetPct)) {
        releaseLightingBrightnessTarget(entityId, token);
        continue;
      }

      tasks.push(
        callLightingService("light", "turn_on", { entity_id: entityId, brightness_pct: targetPct }),
      );
    }

    if (tasks.length) {
      await callMany(tasks);
    }
  } catch (error) {
    console.error("[nova-dashboard] brightness convergence check failed", { error });
  }

  scheduleLightingBrightnessConvergence(token, attempt + 1);
}

export async function applyAdaptiveCandlelightTransitions(housePartyBypass = false) {
  if (!housePartyBypass && deferLightingForHouseParty("automation:adaptive-candlelight", async () => {
    await applyAdaptiveCandlelightTransitions(true);
  })) {
    return null;
  }
  const dashboard = await buildDashboardState();
  const sunState = normalizedSunState(dashboard.sun);
  if (!sunState) {
    return null;
  }

  const adaptiveZones = dashboard.preferences.lighting?.adaptiveCandlelightZones ?? {};
  const zonesById = new Map(dashboard.zones.map((zone) => [zone.id, zone]));
  const touchedEntityIds = new Set<string>();
  let applied = false;

  for (const [zoneId, preference] of Object.entries(adaptiveZones)) {
    if (!preference.enabled || preference.lastSunState === sunState) {
      continue;
    }

    const zone = zonesById.get(zoneId);
    if (!zone) {
      continue;
    }

    const zoneActiveLights = zone.entities.filter((entity) => entity.domain === "light" && entity.state === "on");
    if (!zoneActiveLights.length) {
      // Nothing on to transition, so this crossing is done for the zone. Stamp
      // it rather than leaving the transition pending: the turn-on paths already
      // apply the preset for the live sun state themselves, so a stale stamp
      // only lets this pass ambush the next manual set — which is what made a
      // dimmed morning zone jump to full a minute later.
      await rememberAdaptiveCandlelightZone(zoneId, true, sunState);
      continue;
    }

    const activeLights = zoneActiveLights.filter((entity) => !touchedEntityIds.has(entity.entity_id));
    if (activeLights.length) {
      const preset = adaptiveCandlelightPreset(dashboard.sun);
      const mode = adaptiveLightMode(dashboard.sun);
      const brightness = adaptiveCandlelightBrightnessPct(dashboard.sun);
      await callMany(
        activeLights.map((entity) => {
          touchedEntityIds.add(entity.entity_id);
          const payload: Record<string, unknown> = { entity_id: entity.entity_id };
          if (!applyPinnedPreset(entity, payload, dashboard.lighting, dashboard.sun)) {
            const brightnessPct = adaptiveLightBrightnessPctForEntity(entity, dashboard.lighting, mode, brightness);
            if (supportsBrightness(entity)) {
              payload.brightness_pct = brightnessPct;
            }
            addLightPresetToPayload(entity, payload, preset, dashboard.lighting, mode);
          }
          return callLightingService("light", "turn_on", payload);
        }),
      );
      applied = true;
    }
    await rememberAdaptiveCandlelightZone(zoneId, true, sunState);
  }

  return applied ? buildDashboardState() : null;
}

export async function applyLightingIntensityThresholds(housePartyBypass = false) {
  if (!housePartyBypass && deferLightingForHouseParty("automation:intensity-thresholds", async () => {
    await applyLightingIntensityThresholds(true);
  })) {
    return null;
  }
  const dashboard = await buildDashboardState();
  const tasks: Promise<unknown>[] = [];

  for (const threshold of dashboard.lighting.intensityThresholds) {
    for (const entityId of threshold.entityIds) {
      const entity = dashboard.entities.find((candidate) => candidate.entity_id === entityId);
      if (!entity || !["light", "switch"].includes(entity.domain) || ["unavailable", "unknown"].includes(entity.state)) {
        continue;
      }

      const thresholdPct = intensityThresholdPctForEntity(entity, dashboard.lighting);
      const zone = targetZoneForThresholdEntity(dashboard, entity.entity_id);
      if (thresholdPct === null || !zone) {
        continue;
      }

      const shouldBeOn = zoneHasActiveLighting(zone) && zone.brightnessPct >= thresholdPct;
      if (shouldBeOn && entity.state !== "on") {
        tasks.push(setEntityPower(entity, true));
      } else if (!shouldBeOn && entity.state === "on") {
        tasks.push(setEntityPower(entity, false));
      }
    }
  }

  if (!tasks.length) {
    return null;
  }

  await callMany(tasks);
  return buildDashboardState();
}

// A pinned light is only re-driven when its live look has drifted from the
// preset, so the scheduled pass is a no-op in steady state instead of spamming
// HA every poll. Brightness is compared in percent; colour temp in Kelvin; a
// non-color_temp colour mode (e.g. left in rgb/hs) always counts as drift.
function pinnedLightNeedsReapply(entity: DashboardEntity, payload: Record<string, unknown>): boolean {
  const desiredBrightness = payload.brightness_pct;
  if (typeof desiredBrightness === "number") {
    const rawBrightness = numericAttribute(entity, "brightness");
    const currentPct = rawBrightness === null ? null : Math.round((rawBrightness / 255) * 100);
    if (currentPct === null || Math.abs(currentPct - desiredBrightness) > 2) {
      return true;
    }
  }

  const desiredKelvin = payload.color_temp_kelvin;
  if (typeof desiredKelvin === "number") {
    const colorMode = entity.attributes.color_mode;
    if (typeof colorMode === "string" && colorMode && colorMode !== "color_temp") {
      return true;
    }
    const mireds = numericAttribute(entity, "color_temp");
    const currentKelvin =
      numericAttribute(entity, "color_temp_kelvin") ?? (mireds ? miredToKelvin(mireds) : null);
    if (currentKelvin === null || Math.abs(currentKelvin - desiredKelvin) > 100) {
      return true;
    }
  }

  const desiredRgb = payload.rgb_color;
  if (Array.isArray(desiredRgb)) {
    const currentRgb = entity.attributes.rgb_color;
    if (
      !Array.isArray(currentRgb) ||
      desiredRgb.some((value, index) => Math.abs(Number(value) - Number(currentRgb[index])) > 8)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Scheduled maintenance for pinned lights: keep each pinned fixture that is on
 * snapped to its preset (e.g. the conservatory always warm-white at 100%),
 * reapplying only when its live state has drifted. Off fixtures are left off.
 */
export async function applyPinnedLightPresets(housePartyBypass = false) {
  if (!housePartyBypass && deferLightingForHouseParty("automation:pinned-presets", async () => {
    await applyPinnedLightPresets(true);
  })) {
    return null;
  }
  const dashboard = await buildDashboardState();
  const pinnedPresets = (dashboard.lighting.entityPresets ?? []).filter((preset) => preset.pinned);
  if (!pinnedPresets.length) {
    return null;
  }

  const tasks: Promise<unknown>[] = [];
  for (const preset of pinnedPresets) {
    const entity = dashboard.entities.find((candidate) => candidate.entity_id === preset.entityId.trim());
    if (!entity || entity.domain !== "light" || entity.state !== "on") {
      continue;
    }

    const payload: Record<string, unknown> = { entity_id: entity.entity_id };
    applyPinnedPreset(entity, payload, dashboard.lighting, dashboard.sun);
    if (pinnedLightNeedsReapply(entity, payload)) {
      tasks.push(callLightingService("light", "turn_on", payload));
    }
  }

  if (!tasks.length) {
    return null;
  }

  await callMany(tasks);
  return buildDashboardState();
}

export async function setEntityAction(input: {
  entityId: string;
  domain: HaDomain;
  service: string;
  data?: Record<string, unknown>;
  isCurrent?: () => boolean;
  remember?: Parameters<typeof mergeDashboardPreferences>[0];
  signal?: AbortSignal;
  traceId?: string;
  housePartyBypass?: boolean;
}) {
  const allowed: Record<HaDomain, string[]> = {
    light: ["turn_on", "turn_off", "toggle"],
    switch: ["turn_on", "turn_off", "toggle"],
    climate: [
      "turn_on",
      "turn_off",
      "set_hvac_mode",
      "set_temperature",
      "set_fan_mode",
      "set_swing_mode",
    ],
    fan: ["turn_on", "turn_off", "toggle", "set_percentage"],
    cover: ["open_cover", "close_cover", "stop_cover"],
    humidifier: ["turn_on", "turn_off", "toggle", "set_humidity"],
    sensor: [],
  };

  if (!allowed[input.domain]?.includes(input.service)) {
    throw new Error(`Service ${input.domain}.${input.service} is not allowed`);
  }

  const isAirconRelated =
    input.domain === "climate" ||
    `${input.entityId} ${input.service}`.toLowerCase().match(/\b(air|gree|quiet|turbo|xtra)\b/) !== null;

  if (isAirconRelated) {
    console.info("[nova-dashboard] aircon setEntityAction start", {
      data: input.data ?? {},
      domain: input.domain,
      entityId: input.entityId,
      remember: input.remember,
      service: input.service,
      traceId: input.traceId,
    });
  }

  try {
    let serviceData = {
      entity_id: input.entityId,
      ...(input.data ?? {}),
    };
    if (input.domain === "light" && input.service === "turn_on" && !input.housePartyBypass) {
      const styleKeys = ["brightness", "brightness_pct", "color_temp", "color_temp_kelvin", "hs_color", "rgb_color", "rgbw_color", "rgbww_color", "xy_color"];
      const presentStyleKeys = styleKeys.filter((key) => key in serviceData);
      const hasStyle = presentStyleKeys.length > 0;
      const hasOnlyBrightness = presentStyleKeys.every((key) => key === "brightness" || key === "brightness_pct");
      const deferred = hasStyle && deferLightingForHouseParty(`entity:${input.entityId}`, async () => {
        await setEntityAction({
          ...input,
          housePartyBypass: true,
          isCurrent: undefined,
          signal: undefined,
        });
      });
      if (deferred && !(hasOnlyBrightness && housePartyIgnoresBrightness())) {
        serviceData = { entity_id: input.entityId };
      }
    }
    if (input.domain === "light" || input.domain === "switch") {
      await callLightingService(input.domain, input.service, serviceData, input);
    } else {
      assertLatestCommandCurrent(input);
      await callService(input.domain, input.service, serviceData, { signal: input.signal });
    }
    assertLatestCommandCurrent(input);
  } catch (error) {
    if (isAirconRelated) {
      console.error("[nova-dashboard] aircon setEntityAction service failed", {
        data: input.data ?? {},
        domain: input.domain,
        entityId: input.entityId,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        service: input.service,
        traceId: input.traceId,
      });
    }

    throw error;
  }

  if (input.remember) {
    if (isAirconRelated) {
      console.info("[nova-dashboard] aircon preference merge", {
        remember: input.remember,
        traceId: input.traceId,
      });
    }
    await mergeDashboardPreferences(input.remember);
    assertLatestCommandCurrent(input);
  }

  const nextState = await buildDashboardState();
  if (input.domain === "light" && ["turn_on", "turn_off", "toggle"].includes(input.service)) {
    const entity = nextState.entities.find((candidate) => candidate.entity_id === input.entityId);
    const on = entity?.state === "on";
    for (const zone of nextState.zones) {
      if (zone.entities.some((candidate) => candidate.entity_id === input.entityId)) {
        setHousePartyZonePower(zone.id, on);
      }
    }
  }
  assertLatestCommandCurrent(input);

  if (isAirconRelated) {
    const entity = nextState.entities.find((candidate) => candidate.entity_id === input.entityId);
    console.info("[nova-dashboard] aircon setEntityAction complete", {
      entity: entity
        ? {
            attributes: entity.attributes,
            entity_id: entity.entity_id,
            name: entity.name,
            state: entity.state,
          }
        : null,
      traceId: input.traceId,
    });
  }

  return nextState;
}
