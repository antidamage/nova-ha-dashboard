import { applyClimateControlIntent } from "../../climate-control";
import { climateInstances } from "../../climate-instances";
import { readDashboardConfig } from "../../dashboard-config";
import type { ClimateArrivalPreset } from "../../config-schema/arrivals";
import type { ArrivalPreset, ArrivalTarget } from "../types";

/**
 * Air conditioning presets are configuration, not a feature of the climate card:
 * nothing else in the dashboard has a named aircon preset to borrow, so
 * dashboard.arrivals.climatePresets defines them and this target applies one
 * through the same intent the climate card's own API uses.
 *
 * With the list empty (it ships empty) the picker offers nothing for this target,
 * and a state naming a preset that is not there fails loudly, naming it.
 */

export async function climateArrivalPresets(): Promise<ClimateArrivalPreset[]> {
  return (await readDashboardConfig()).dashboard.arrivals.climatePresets;
}

export const climateArrivalTarget: ArrivalTarget = {
  kind: "climate",
  label: "Air conditioning",

  async presets(): Promise<ArrivalPreset[]> {
    return (await climateArrivalPresets()).map((preset) => ({ id: preset.id, label: preset.label }));
  },

  async apply(presetId: string) {
    const config = await readDashboardConfig();
    const preset = config.dashboard.arrivals.climatePresets.find((candidate) => candidate.id === presetId);
    if (!preset) throw new Error(`Unknown air-conditioning preset: ${presetId}`);
    // applyClimateControlIntent returns the controller state untouched when the
    // instance id resolves to nothing, which would read as a state that landed.
    const instance = climateInstances(config).find((candidate) => candidate.id === preset.instanceId);
    if (!instance) {
      throw new Error(`Preset "${preset.label}" names a climate device that is not configured: ${preset.instanceId}`);
    }
    await applyClimateControlIntent({
      room: preset.instanceId,
      mode: preset.mode,
      ...(preset.direction ? { direction: preset.direction } : {}),
      ...(preset.temperature !== undefined ? { temperature: preset.temperature } : {}),
    });
  },
};
