import type { DashboardConfig } from "../config-schema";
import { DEFAULT_NIGHT_MAX_BRIGHTNESS_PCT } from "../config-schema/home-users";
import { lightLayerEntities, zoneFromEntities } from "../ha/zones";
import { homeIdsOf, readPresence } from "../presence/store";
import type { DashboardEntity, DashboardZone, HomeUserState } from "../types";
import { controlledZoneIds, homeUsers, memberZoneId } from "./model";
import { nightCapsFor } from "./night-cap-model";

/**
 * What the dashboard state carries for home users (specs/home-users.md): each
 * home user with their presence, one "All lights" zone per user, and the night
 * cap per entity. Kept out of lib/state.ts so that file only wires it in.
 */

function memberZones(config: DashboardConfig, zones: DashboardZone[]): DashboardZone[] {
  const byId = new Map(zones.map((zone) => [zone.id, zone]));
  return homeUsers(config.dashboard.people).map((person) => {
    const seen = new Set<string>();
    const lights: DashboardEntity[] = [];
    for (const zoneId of controlledZoneIds(person)) {
      for (const entity of lightLayerEntities(byId.get(zoneId)?.entities ?? [])) {
        if (!seen.has(entity.entity_id)) {
          seen.add(entity.entity_id);
          lights.push(entity);
        }
      }
    }
    const zone = zoneFromEntities(memberZoneId(person.id), "All lights", lights, config.homeAssistant.controlDomains);
    zone.special = "member";
    return zone;
  });
}

export async function homeUsersState(config: DashboardConfig, zones: DashboardZone[]) {
  const presence = await readPresence();
  const homeIds = homeIdsOf(presence);
  const people = config.dashboard.people;
  const users: HomeUserState[] = homeUsers(people).map((person) => ({
    id: person.id,
    label: person.label,
    color: person.color,
    rooms: person.rooms ?? [],
    showSystemTabs: person.showSystemTabs ?? false,
    quickAccess: person.quickAccess ?? [],
    nightMaxBrightnessPct: person.nightMaxBrightnessPct ?? DEFAULT_NIGHT_MAX_BRIGHTNESS_PCT,
    home: homeIds.has(person.id),
    changedAt: presence.members[person.id]?.changedAt ?? null,
  }));
  return {
    homeUsers: users,
    homeZones: config.dashboard.zones,
    memberZones: memberZones(config, zones),
    nightCapPctByEntity: nightCapsFor({ people, zoneSettings: config.dashboard.zones, homeIds, zones }),
  };
}
