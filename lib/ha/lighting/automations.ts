// Scheduled host passes for intensity thresholds and pinned light presets.
import type { DashboardEntity } from "../../types";
import { intensityThresholdPctForEntity } from "../../lighting-thresholds";
import { deferLightingForHouseParty } from "../../house-party-coordinator";
import { buildDashboardState } from "../../state";
import { callLightingService, callMany, setEntityPower } from "./commands";
import {
  applyPinnedPreset,
  miredToKelvin,
  numericAttribute,
  targetZoneForThresholdEntity,
  zoneHasActiveLighting,
} from "./light-model";

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
