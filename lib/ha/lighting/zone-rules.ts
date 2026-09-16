// Zone light rules: timed light events, the single host pass over every rule
// kind, and a rule's manual trigger (specs/zone-light-events.md).
import type { DashboardState } from "../../types";
import { readDashboardConfigSync } from "../../dashboard-config";
import { dueOccurrence, eventTurnsLightsOff } from "../../light-events";
import {
  clearStagedLightValues,
  readLightEventState,
  recordLightEventFired,
  stageLightValues,
  type StagedLightValue,
} from "../../light-event-state";
import { hsvToRgb } from "../../../app/components/colorEncoderModel";
import { projectLightingRules, ruleTrigger, type ZoneLightRule } from "../../zone-light-rules";
import { deferLightingForHouseParty } from "../../house-party-coordinator";
import { buildDashboardState } from "../../state";
import { callLightingService, callMany, setEntityPower } from "./commands";
import { applyPinnedPreset, supportsBrightness } from "./light-model";
import { applyAdaptiveCandlelightTransitions } from "./adaptive";
import { applyLightingIntensityThresholds, applyPinnedLightPresets } from "./automations";
import { ensureZoneLightRulesMigrated } from "./store";
import { setZoneAction } from "./zone-action";

/**
 * Fire any zone light event that has come due. Runs on the host poller, so the
 * rules apply with every dashboard closed (specs/zone-light-events.md).
 *
 * An event is fire-and-forget: it sets the zone's lights once and holds
 * nothing afterwards. A light that is off only changes when it is listed as
 * one an event may switch on; otherwise the value is staged for its next
 * switch-on.
 */
export async function applyZoneLightEvents(housePartyBypass = false) {
  if (!housePartyBypass && deferLightingForHouseParty("automation:light-events", async () => {
    await applyZoneLightEvents(true);
  })) {
    return null;
  }

  const config = readDashboardConfigSync();
  const projected = projectLightingRules(config.dashboard.lighting);
  const events = projected.zoneEvents ?? [];
  if (!events.length) {
    return null;
  }

  const now = new Date();
  const persisted = await readLightEventState();
  const dashboard = await buildDashboardState();
  const switchOnIds = new Set(projected.eventSwitchOnEntityIds ?? []);

  const tasks: Promise<unknown>[] = [];
  const staged: Record<string, StagedLightValue> = {};
  const stagedToClear: string[] = [];
  const fired: Array<[string, Date]> = [];

  for (const event of events) {
    const occurrence = dueOccurrence(event, now, {
      lastFiredIso: persisted.lastFired[event.id] ?? null,
      sun: dashboard.sun,
    });
    if (!occurrence) {
      continue;
    }

    const zone = dashboard.zones.find((candidate) => candidate.id === event.zoneId);
    if (!zone) {
      continue;
    }

    fired.push([event.id, occurrence]);
    const lights = zone.entities.filter((entity) => entity.domain === "light" || entity.domain === "switch");
    const off = eventTurnsLightsOff(event);
    const rgb = hsvToRgb(event.value.hue, event.value.saturation, 100);

    for (const entity of lights) {
      if (["unavailable", "unknown"].includes(entity.state)) {
        continue;
      }

      // Zero brightness is off, for a colour bulb and a switched neon alike.
      if (off) {
        stagedToClear.push(entity.entity_id);
        if (entity.state === "on") {
          tasks.push(setEntityPower(entity, false));
        }
        continue;
      }

      if (entity.domain === "switch" || !supportsBrightness(entity)) {
        // Nothing to colour: any level above zero simply means on.
        if (entity.state !== "on" && switchOnIds.has(entity.entity_id)) {
          tasks.push(setEntityPower(entity, true));
        }
        continue;
      }

      if (entity.state !== "on" && !switchOnIds.has(entity.entity_id)) {
        staged[entity.entity_id] = {
          rgb,
          brightnessPct: event.value.brightnessPct,
          stagedAt: now.toISOString(),
        };
        continue;
      }

      const payload: Record<string, unknown> = { entity_id: entity.entity_id };
      if (!applyPinnedPreset(entity, payload, dashboard.lighting, dashboard.sun)) {
        payload.brightness_pct = event.value.brightnessPct;
        payload.rgb_color = rgb;
      }
      stagedToClear.push(entity.entity_id);
      tasks.push(callLightingService("light", "turn_on", payload));
    }
  }

  if (!fired.length) {
    return null;
  }

  await callMany(tasks);
  await stageLightValues(staged);
  await clearStagedLightValues(stagedToClear);
  for (const [eventId, occurrence] of fired) {
    await recordLightEventFired(eventId, occurrence);
  }

  return tasks.length ? buildDashboardState() : null;
}

/**
 * The one host pass for every lighting rule kind (specs/zone-light-events.md).
 * Each kind keeps its own House Party deferral, once-per-occurrence and
 * lateness handling; the result names which kinds changed something.
 */
export async function runZoneLightRules(): Promise<Array<[string, DashboardState]>> {
  try {
    await ensureZoneLightRulesMigrated();
  } catch (error) {
    console.error("[nova-dashboard] zone light rule migration failed", { error });
  }
  const kinds: Array<[string, () => Promise<DashboardState | null | undefined>]> = [
    ["adaptive-candlelight", applyAdaptiveCandlelightTransitions],
    ["intensity-threshold", applyLightingIntensityThresholds],
    ["pinned-preset", applyPinnedLightPresets],
    ["light-event", applyZoneLightEvents],
  ];
  const changed: Array<[string, DashboardState]> = [];
  for (const [event, run] of kinds) {
    const state = await run();
    if (state) changed.push([event, state]);
  }
  return changed;
}

/** Apply one rule now, as its preset button does. */
export async function triggerZoneLightRule(rule: ZoneLightRule) {
  const trigger = ruleTrigger(rule);
  if (trigger.kind === "host") {
    return trigger.automation === "threshold"
      ? applyLightingIntensityThresholds()
      : applyPinnedLightPresets();
  }
  return setZoneAction({
    zoneId: rule.zoneId,
    action: trigger.action,
    brightnessPct: trigger.brightnessPct,
    rgb: trigger.rgb,
  });
}
