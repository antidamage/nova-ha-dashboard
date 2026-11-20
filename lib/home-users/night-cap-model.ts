import { DEFAULT_NIGHT_MAX_BRIGHTNESS_PCT, type HomeZoneSetting } from "../config-schema/home-users";
import type { HouseholdPerson } from "../config-schema/power";
import { homeUsers, isMemberZoneId, isOutsideZone, personCountsForZone } from "./model";

/**
 * The night cap (specs/home-users.md section 6): at night no adaptive light
 * goes brighter than the lowest `nightMaxBrightnessPct` among the home users
 * who are home and count toward a zone holding it. A bedroom counts only its
 * owners, so one person's low cap never dims another's bedroom.
 *
 * An entity no home user counts toward gets no entry, and today's default
 * stands for it.
 */

type CapZone = {
  id: string;
  name?: string;
  special?: string;
  entities: ReadonlyArray<{ entity_id: string; domain: string; isIllumination?: boolean }>;
};

type CapPerson = Pick<HouseholdPerson, "id" | "rooms" | "quickAccess" | "nightMaxBrightnessPct">;

export function nightCapsFor(input: {
  people: readonly CapPerson[];
  zoneSettings: readonly HomeZoneSetting[];
  homeIds: ReadonlySet<string>;
  zones: readonly CapZone[];
}): Record<string, number> {
  const present = homeUsers(input.people).filter((person) => input.homeIds.has(person.id));
  const caps: Record<string, number> = {};
  if (!present.length) return caps;

  for (const zone of input.zones) {
    // The aggregate and per-user zones are views over rooms; the rooms decide.
    if (zone.id === "everything" || zone.special || isMemberZoneId(zone.id) || isOutsideZone(zone)) continue;
    const counted = present.filter((person) => personCountsForZone(person, input.zoneSettings, zone.id));
    if (!counted.length) continue;
    const zoneCap = Math.min(...counted.map((person) => person.nightMaxBrightnessPct ?? DEFAULT_NIGHT_MAX_BRIGHTNESS_PCT));
    for (const entity of zone.entities) {
      if (entity.domain !== "light" && !entity.isIllumination) continue;
      const existing = caps[entity.entity_id];
      caps[entity.entity_id] = existing === undefined ? zoneCap : Math.min(existing, zoneCap);
    }
  }
  return caps;
}
