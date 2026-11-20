import { quickAccessControlsFor } from "../../../lib/home-users/quick-access-model";
import type { DashboardState, HomeUserState } from "../../../lib/types";
import type { buildZoneTree } from "../dashboard/ZonesPanel";

/**
 * What one home user sees (specs/home-users.md section 3): their rooms only,
 * Home and the Systems accordion only with `showSystemTabs`, and their own
 * Quick Access. Undecided and Household see everything, exactly as before.
 */

type ZoneTree = ReturnType<typeof buildZoneTree>;

export function viewForHomeUser(tree: ZoneTree, person: HomeUserState | null): ZoneTree & { systemsVisible: boolean } {
  if (!person) return { ...tree, systemsVisible: true };
  const rooms = new Set(person.rooms);
  const systems = person.showSystemTabs;
  return {
    ...tree,
    inside: systems ? tree.inside : null,
    indoor: tree.indoor.filter((zone) => rooms.has(zone.id)),
    climate: systems ? tree.climate : null,
    outside: systems ? tree.outside : null,
    network: systems ? tree.network : null,
    power: systems ? tree.power : null,
    systemsVisible: systems,
  };
}

/** A selection the user can no longer see falls back to their first visible zone. */
export function visibleHomeSelection(tree: ZoneTree, selected: string | null) {
  const visible = [tree.inside, ...tree.indoor].filter(Boolean).map((zone) => zone!.id);
  return selected && visible.includes(selected) ? selected : (visible[0] ?? null);
}

/**
 * The state the person's Quick Access is resolved against: their own controls,
 * and the zones including their All lights zone, so the room-lighting renderer
 * finds it by id like any room.
 */
export function quickAccessDataFor(data: DashboardState | null, person: HomeUserState | null): DashboardState | null {
  if (!data || !person) return data;
  const zones = [...data.zones, ...(data.memberZones ?? [])];
  return { ...data, zones, controls: quickAccessControlsFor(person, data.controls, zones) };
}

export function emptyRoomsNotice(tree: ZoneTree, person: HomeUserState | null) {
  if (!person || tree.inside || tree.indoor.length) return null;
  return `No rooms are assigned to ${person.label}. An admin can add them in Config → Home Users.`;
}
