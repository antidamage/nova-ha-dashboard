import type { ControlPreset } from "../../../lib/control-modules/types";
import type { DashboardState } from "../../../lib/types";

/**
 * A climate control's title follows its room's current name (specs/home-users.md
 * section 9), so renaming a room in Home Assistant renames its heater or air
 * conditioner too. The room is the preset's own, or, for a legacy instance with
 * none, the zone its id names. Anything else keeps the preset's name.
 */
export function climateTitle(preset: Pick<ControlPreset, "id" | "name" | "roomId">, data: DashboardState | null) {
  const zoneId = preset.roomId ?? preset.id;
  return data?.zones.find((zone) => zone.id === zoneId && !zone.special)?.name ?? preset.name;
}
