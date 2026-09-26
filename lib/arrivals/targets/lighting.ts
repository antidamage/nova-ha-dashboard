import { readDashboardConfig } from "../../dashboard-config";
import { buildDashboardState, triggerZoneLightRule } from "../../ha";
import { findRule, presetRowRules, storeFromLighting, type ZoneLightRuleStore } from "../../zone-light-rules";
import type { ArrivalPreset, ArrivalTarget } from "../types";

/**
 * Lighting's presets already exist: they are the zone light rules of kind
 * `preset` / `adaptive`, i.e. exactly the buttons in a room's preset row, plus
 * the built-in On and Off every zone has. Nothing is duplicated here, so a preset
 * that changes its colour or is renamed in the zone editor changes what an
 * arrival can pick. There is no whole-house preset to offer, and none is invented.
 */

async function ruleStore(): Promise<ZoneLightRuleStore> {
  const config = await readDashboardConfig();
  // storeFromLighting, not the API's readRuleStore: applying a preset must not
  // run the host-side rule migration as a side effect of someone arriving home.
  return storeFromLighting(config.dashboard.lighting);
}

/**
 * The zones, and what to call them. Room names come from Home Assistant; with it
 * unreadable the zone ids still identify the rooms, so the list degrades to ids
 * rather than to nothing.
 */
async function rooms(): Promise<Array<{ id: string; name: string }>> {
  try {
    const state = await buildDashboardState();
    const zones = state.zones
      .filter((zone) => !zone.special)
      .map((zone) => ({ id: zone.id, name: zone.name }));
    if (zones.length) return zones;
  } catch {
    // Falls through to the ids the config itself knows about.
  }
  const store = await ruleStore();
  return [...new Set(store.rules.map((rule) => rule.zoneId))].map((id) => ({ id, name: id }));
}

export const lightingArrivalTarget: ArrivalTarget = {
  kind: "lighting",
  label: "Lighting",

  async presets(): Promise<ArrivalPreset[]> {
    const store = await ruleStore();
    const presets: ArrivalPreset[] = [];
    for (const room of await rooms()) {
      for (const rule of presetRowRules(store, room.id)) {
        presets.push({
          id: rule.id,
          label: `${room.name} · ${rule.name ?? "Preset"}`,
          group: room.name,
        });
      }
    }
    return presets;
  },

  async apply(presetId: string) {
    const rule = findRule(await ruleStore(), presetId);
    if (!rule) throw new Error(`Unknown lighting preset: ${presetId}`);
    await triggerZoneLightRule(rule);
  },
};
