import type { HouseholdPerson } from "../config-schema/power";
import type { ControlPreset, ControlSlot, ControlsConfig } from "../control-modules/types";
import { memberZoneId } from "./model";

/**
 * A home user's Quick Access card as a ControlsConfig (specs/home-users.md
 * section 4): the stored presets, plus a generated room-lighting preset for each
 * `room-lights` / `all-lights` entry, plus one quick-access slot per entry, in
 * the person's order. The card then renders through the existing slot code, so
 * a user's card needs no control code of its own.
 *
 * An entry whose preset does not exist is dropped here, the same way a slot
 * with a missing preset is dropped on the shared card.
 */

const ROOM_LIGHTING_MODULE = "room-lighting";
/** Modules drawn on the card's wide line slots rather than as dials. */
const LINE_MODULES = new Set(["outside-weather", "host-temperatures"]);

type ZoneName = { id: string; name: string };

function lightingPreset(id: string, name: string, roomId: string): ControlPreset {
  return {
    id,
    moduleId: ROOM_LIGHTING_MODULE,
    name,
    roomId,
    driverId: null,
    variant: null,
    features: {},
    binding: {},
  };
}

export function quickAccessControlsFor(
  person: Pick<HouseholdPerson, "id" | "quickAccess">,
  controls: ControlsConfig,
  zones: readonly ZoneName[],
): ControlsConfig {
  const generated: ControlPreset[] = [];
  const slots: ControlSlot[] = [];
  const known = new Set(controls.presets.map((preset) => preset.id));

  for (const entry of person.quickAccess ?? []) {
    let presetId: string | null = null;
    let roomId: string | null = null;
    if (entry.kind === "preset") {
      if (!known.has(entry.presetId)) continue;
      presetId = entry.presetId;
    } else if (entry.kind === "room-lights") {
      const zone = zones.find((candidate) => candidate.id === entry.zoneId);
      if (!zone) continue;
      presetId = `home-user:${person.id}:room:${zone.id}`;
      roomId = zone.id;
      generated.push(lightingPreset(presetId, zone.name, zone.id));
    } else {
      roomId = memberZoneId(person.id);
      if (!zones.some((zone) => zone.id === roomId)) continue;
      presetId = `home-user:${person.id}:all-lights`;
      generated.push(lightingPreset(presetId, "All lights", roomId));
    }
    if (slots.some((slot) => slot.presetId === presetId)) continue;
    slots.push({ id: `quick-access-${presetId}`, surface: "quick-access", presetId, roomId, visible: true });
  }

  // The line slots under the dials (weather, host gauges) are the house's, not a
  // person's: a list that names none of its own keeps the shared card's lines
  // (alex, 2026-11-21: a person's card had "lost the weather and gauges").
  const lineModule = (presetId: string | null) =>
    LINE_MODULES.has(controls.presets.find((preset) => preset.id === presetId)?.moduleId ?? "");
  // An empty list is an empty card (§4), so it inherits nothing.
  const sharedLines = slots.length === 0 || slots.some((slot) => lineModule(slot.presetId))
    ? []
    : controls.slots.filter((slot) => slot.surface === "quick-access" && lineModule(slot.presetId));

  return {
    ...controls,
    presets: [...controls.presets, ...generated],
    // Every other surface keeps its shared slots; only Quick Access is personal.
    slots: [...controls.slots.filter((slot) => slot.surface !== "quick-access"), ...slots, ...sharedLines],
  };
}
