import type { HouseholdPerson } from "../../../../lib/config-schema";
import type { HomeUserQuickAccessEntry, HomeZoneSetting } from "../../../../lib/config-schema/home-users";

/**
 * The Home Users edits (specs/home-users.md section 8), as pure functions over
 * the people list and the zone flags, so the section's buttons are one-line
 * calls and every edit is unit-testable. An edit that changes nothing returns
 * the list it was given, which the section reads as "write nothing".
 */

type Patch = Partial<Pick<HouseholdPerson, "rooms" | "showSystemTabs" | "quickAccess" | "nightMaxBrightnessPct">>;

export function patchMember(members: HouseholdPerson[], id: string, patch: Patch): HouseholdPerson[] {
  return members.map((member) => (member.id === id ? { ...member, ...patch } : member));
}

export function toggleRoom(members: HouseholdPerson[], id: string, zoneId: string): HouseholdPerson[] {
  const member = members.find((candidate) => candidate.id === id);
  if (!member) return members;
  const rooms = member.rooms ?? [];
  return patchMember(members, id, {
    rooms: rooms.includes(zoneId) ? rooms.filter((room) => room !== zoneId) : [...rooms, zoneId],
  });
}

export function quickAccessKey(entry: HomeUserQuickAccessEntry) {
  if (entry.kind === "preset") return `preset:${entry.presetId}`;
  if (entry.kind === "room-lights") return `room-lights:${entry.zoneId}`;
  return "all-lights";
}

export function entryFromKey(key: string): HomeUserQuickAccessEntry | null {
  if (key === "all-lights") return { kind: "all-lights" };
  if (key.startsWith("preset:")) return { kind: "preset", presetId: key.slice("preset:".length) };
  if (key.startsWith("room-lights:")) return { kind: "room-lights", zoneId: key.slice("room-lights:".length) };
  return null;
}

export function addQuickAccess(members: HouseholdPerson[], id: string, key: string): HouseholdPerson[] {
  const member = members.find((candidate) => candidate.id === id);
  const entry = entryFromKey(key);
  if (!member || !entry) return members;
  const list = member.quickAccess ?? [];
  if (list.some((existing) => quickAccessKey(existing) === key)) return members;
  return patchMember(members, id, { quickAccess: [...list, entry] });
}

export function removeQuickAccess(members: HouseholdPerson[], id: string, index: number): HouseholdPerson[] {
  const member = members.find((candidate) => candidate.id === id);
  if (!member) return members;
  return patchMember(members, id, { quickAccess: (member.quickAccess ?? []).filter((_, at) => at !== index) });
}

export function moveQuickAccess(members: HouseholdPerson[], id: string, index: number, by: -1 | 1): HouseholdPerson[] {
  const member = members.find((candidate) => candidate.id === id);
  const list = [...(member?.quickAccess ?? [])];
  const to = index + by;
  if (!member || to < 0 || to >= list.length) return members;
  [list[index], list[to]] = [list[to], list[index]];
  return patchMember(members, id, { quickAccess: list });
}

export type HomeZoneFlag = "bedroom" | "firstHomeLight" | "nightLight";

export function setZoneFlag(
  zones: HomeZoneSetting[],
  zoneId: string,
  key: HomeZoneFlag,
  value: boolean,
): HomeZoneSetting[] {
  const existing = zones.find((zone) => zone.zoneId === zoneId);
  if (existing) return zones.map((zone) => (zone.zoneId === zoneId ? { ...zone, [key]: value } : zone));
  return [...zones, { zoneId, bedroom: false, firstHomeLight: false, nightLight: false, [key]: value }];
}

export type QuickAccessOption = { value: string; label: string; group?: string };

/** What can be added: All lights, each room's lights, and every control preset. */
export function quickAccessOptions(
  rooms: ReadonlyArray<{ id: string; name: string }>,
  presets: ReadonlyArray<{ id: string; name: string; moduleId: string }>,
): QuickAccessOption[] {
  return [
    { value: "all-lights", label: "All lights", group: "Lights" },
    ...rooms.map((room) => ({ value: `room-lights:${room.id}`, label: `${room.name} lights`, group: "Lights" })),
    ...presets
      .filter((preset) => preset.moduleId !== "panel-content")
      .map((preset) => ({ value: `preset:${preset.id}`, label: preset.name, group: "Controls" })),
  ];
}
