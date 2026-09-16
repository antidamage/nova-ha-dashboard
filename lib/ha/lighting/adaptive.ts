// Adaptive candlelight: per-zone sun-state memory and the scheduled
// sunrise/sunset transition.
import type { DashboardEntity, DashboardState } from "../../types";
import { mergeDashboardPreferences } from "../../preferences";
import { adaptiveLightBrightnessPctForEntity, adaptiveLightMode } from "../../lighting-presets";
import { adaptiveRuleEnabled } from "../../zone-light-rules";
import { deferLightingForHouseParty } from "../../house-party-coordinator";
import { buildDashboardState } from "../../state";
import { callLightingService, callMany } from "./commands";
import {
  addLightPresetToPayload,
  adaptiveCandlelightBrightnessPct,
  adaptiveCandlelightPreset,
  applyPinnedPreset,
  normalizedSunState,
  supportsBrightness,
} from "./light-model";
import type { AdaptiveSunState } from "./types";

export async function rememberAdaptiveCandlelightZone(zoneId: string, enabled: boolean, sunState: AdaptiveSunState | null) {
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
export async function acknowledgeAdaptiveSunStateForEntities(
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
    // Whether the zone takes part at all is its adaptive rule; the preference
    // only says it is currently following (specs/zone-light-events.md).
    if (!adaptiveRuleEnabled(dashboard.lighting, zoneId)) {
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
