import type { HomeZoneSetting } from "../config-schema/home-users";
import type { HouseholdPerson } from "../config-schema/power";

/**
 * Who the home users are, and which rooms each one has (specs/home-users.md
 * section 1). Pure: everything here takes the config lists it needs.
 */

/** The prefix of the per-user "All lights" zone id (section 4.1). */
export const MEMBER_ZONE_PREFIX = "member:";

export function memberZoneId(personId: string) {
  return `${MEMBER_ZONE_PREFIX}${personId}`;
}

export function isMemberZoneId(zoneId: string | null | undefined) {
  return Boolean(zoneId?.startsWith(MEMBER_ZONE_PREFIX));
}

/**
 * The Outside zone, by the same test the client uses. Its lights are switched,
 * never dimmed, so the night cap and adaptive arrival never apply to them.
 */
export function isOutsideZone(zone: { id: string; name?: string }) {
  return zone.id === "outside" || (zone.name ?? "").trim().toLowerCase() === "outside";
}

/** A person is a home user when they have at least one room. */
export function isHomeUser(person: Pick<HouseholdPerson, "rooms">) {
  return (person.rooms ?? []).length > 0;
}

export function homeUsers<T extends Pick<HouseholdPerson, "rooms">>(people: readonly T[]): T[] {
  return people.filter(isHomeUser);
}

export function findHomeUser<T extends Pick<HouseholdPerson, "id" | "rooms">>(
  people: readonly T[],
  id: string | null | undefined,
): T | null {
  if (!id) return null;
  return homeUsers(people).find((person) => person.id === id) ?? null;
}

function settingFor(zones: readonly HomeZoneSetting[], zoneId: string) {
  return zones.find((zone) => zone.zoneId === zoneId) ?? null;
}

export function isBedroom(zones: readonly HomeZoneSetting[], zoneId: string) {
  return settingFor(zones, zoneId)?.bedroom === true;
}

export function isArrivalLight(zones: readonly HomeZoneSetting[], zoneId: string) {
  return settingFor(zones, zoneId)?.arrivalLight === true;
}

/** The rooms this person sees, plus every room their Quick Access lights point at. */
export function controlledZoneIds(person: Pick<HouseholdPerson, "rooms" | "quickAccess">): string[] {
  const zoneIds = new Set(person.rooms ?? []);
  for (const entry of person.quickAccess ?? []) {
    if (entry.kind === "room-lights") zoneIds.add(entry.zoneId);
  }
  return [...zoneIds];
}

/** The bedrooms this person owns: bedroom-flagged zones in their own rooms. */
export function bedroomsOf(person: Pick<HouseholdPerson, "rooms">, zones: readonly HomeZoneSetting[]): string[] {
  return (person.rooms ?? []).filter((zoneId) => isBedroom(zones, zoneId));
}

/** Whether `person` counts toward `zoneId`: they control it, and a bedroom only counts its owners. */
export function personCountsForZone(
  person: Pick<HouseholdPerson, "rooms" | "quickAccess">,
  zones: readonly HomeZoneSetting[],
  zoneId: string,
) {
  if (isBedroom(zones, zoneId)) return (person.rooms ?? []).includes(zoneId);
  return controlledZoneIds(person).includes(zoneId);
}
