// Sole owner of module-level state in lib/ha/lighting: the House Party frame
// cache and throttle clocks, and the zone-rule migration failure latch. The
// functions that assign that state live here with it, because a sibling cannot
// assign an imported binding. Do not add a module-level `let` elsewhere in
// this package.
import type { DashboardState } from "../../types";
import { readDashboardConfigSync } from "../../dashboard-config";
import { callService } from "../client";
import { migrateLightingRules } from "../../zone-light-rules";
import { buildDashboardState } from "../../state";
import { isHousePartyZoneSuppressed } from "../../house-party-coordinator";
import { housePartyNativeTransitionSeconds, randomHueOffsetRgb } from "../../house-party";
import { PHONOSCOPE_HUE_OFFSET_EFFECT } from "../../phonoscope-drivers";
import { PHONOSCOPE_PICTURE_EFFECTS } from "../../phonoscope-effects";
import { supportsColor } from "./light-model";
import type { HousePartyLightingFrame } from "./types";

const PHONOSCOPE_HUE_OFFSET_DEFAULT = PHONOSCOPE_PICTURE_EFFECTS
  .find((effect) => effect.id === PHONOSCOPE_HUE_OFFSET_EFFECT)?.default ?? 0;

const HOUSE_PARTY_STATE_CACHE_MS = 500;
const HOUSE_PARTY_CLOUD_FRAME_INTERVAL_MS = 200;
const HOUSE_PARTY_DEVICE_CALL_TIMEOUT_MS = 900;
let housePartyStateCache: { expiresAt: number; state: DashboardState } | null = null;
let lastHousePartyCloudFrameAt = 0;
const lastHousePartyNativeFrameAt = new Map<string, number>();

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
  // A cloud twin's bridge does not accept the same service options as the LAN
  // entity, so the two are commanded differently. Which entity ids are twins is
  // an installation detail, not a fact about lights, so it comes from config.
  const cloudPrefixes = readDashboardConfigSync().homeAssistant.cloudTwinIdentifierPrefixes;
  const isCloudTwin = (entityId: string) =>
    cloudPrefixes.some((prefix) => prefix && entityId.slice(entityId.indexOf(".") + 1).startsWith(prefix));
  const localEntityIds = [...entityIds].filter((entityId) => !isCloudTwin(entityId));
  const cloudEntityIds = [...entityIds].filter((entityId) => isCloudTwin(entityId));
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

let zoneRuleMigrationFailed = false;

/**
 * Write the old per-automation keys back as rules, once. Runs on the host,
 * which is the only place that knows the zones a rule belongs to.
 */
export async function ensureZoneLightRulesMigrated(dashboard?: DashboardState) {
  const config = readDashboardConfigSync();
  const lighting = config.dashboard.lighting;
  const pending = (lighting.zoneEvents?.length ?? 0) > 0
    || (lighting.intensityThresholds?.length ?? 0) > 0
    || (lighting.entityPresets ?? []).some((preset) => preset.pinned);
  const state = dashboard ?? (pending || !zoneRuleMigrationFailed ? await buildDashboardState() : null);
  if (!state) return false;
  const result = migrateLightingRules(lighting, state.zones);
  if (!result.changed) return false;
  const { patchDashboardConfig } = await import("../../dashboard-config");
  const written = await patchDashboardConfig({ dashboard: { lighting: result.lighting } });
  if (!written.ok) {
    if (!zoneRuleMigrationFailed) {
      console.error("[nova-dashboard] zone light rule migration failed", { errors: written.errors });
    }
    zoneRuleMigrationFailed = true;
    return false;
  }
  zoneRuleMigrationFailed = false;
  return true;
}
