import type { HomeZoneSetting } from "../config-schema/home-users";
import type { HouseholdPerson } from "../config-schema/power";
import { bedroomsOf, controlledZoneIds, homeUsers, isArrivalLight } from "../home-users/model";

/**
 * The occupancy rules (specs/home-users.md section 5): what the house does when
 * a home user arrives or leaves, given who else is home and whether the sun is
 * up. Pure, so every row of the spec's table is a unit test.
 *
 * Only lights and heaters ever appear here. Air conditioning is never touched,
 * and no action ever turns a heater on.
 */

export type PresenceEventKind = "arrival" | "departure";

export type PresenceAction =
  | { kind: "lights-off-house" }
  | { kind: "lights-off"; zones: string[] }
  | { kind: "lights-on"; zones: string[] }
  | { kind: "heater-off"; zones: string[] };

type RulePerson = Pick<HouseholdPerson, "id" | "rooms" | "quickAccess">;

export function decidePresenceActions(input: {
  event: PresenceEventKind;
  member: RulePerson;
  people: readonly RulePerson[];
  zoneSettings: readonly HomeZoneSetting[];
  /** Home user ids home before this event. */
  homeBefore: ReadonlySet<string>;
  sunUp: boolean;
}): PresenceAction[] {
  const { member, zoneSettings } = input;
  const wasHome = input.homeBefore.has(member.id);
  // Idempotent: repeating a state the member is already in changes nothing.
  if ((input.event === "arrival") === wasHome) return [];

  const others = homeUsers(input.people).filter(
    (person) => person.id !== member.id && input.homeBefore.has(person.id),
  );
  const bedrooms = bedroomsOf(member, zoneSettings);

  if (input.event === "departure") {
    if (!others.length) {
      return [{ kind: "lights-off-house" }, ...heaterOff(bedrooms)];
    }
    // A bedroom someone still home also owns stays lit.
    const ownedByOthers = new Set(others.flatMap((person) => bedroomsOf(person, zoneSettings)));
    const leaving = bedrooms.filter((zoneId) => !ownedByOthers.has(zoneId));
    return [...lightsOff(leaving), ...heaterOff(leaving)];
  }

  const controlled = controlledZoneIds(member);
  if (!others.length) return lightsOn(controlled);
  if (input.sunUp) return lightsOn(bedrooms);
  const welcome = controlled.filter((zoneId) => isArrivalLight(zoneSettings, zoneId));
  return lightsOn([...new Set([...bedrooms, ...welcome])]);
}

function lightsOn(zones: string[]): PresenceAction[] {
  return zones.length ? [{ kind: "lights-on", zones }] : [];
}

function lightsOff(zones: string[]): PresenceAction[] {
  return zones.length ? [{ kind: "lights-off", zones }] : [];
}

function heaterOff(zones: string[]): PresenceAction[] {
  return zones.length ? [{ kind: "heater-off", zones }] : [];
}

/** One sentence for the who-is-home confirm, worded from the actions. */
export function describePresenceActions(name: string, event: PresenceEventKind, actions: PresenceAction[]) {
  const verb = event === "arrival" ? `Mark ${name} home?` : `Mark ${name} away?`;
  if (!actions.length) return `${verb} Nothing else changes.`;
  if (actions.some((action) => action.kind === "lights-off-house")) {
    return `${verb} Nobody else is home, so every light turns off.`;
  }
  const on = actions.find((action) => action.kind === "lights-on");
  if (on && on.kind === "lights-on") return `${verb} Lights turn on in ${on.zones.length} room${on.zones.length === 1 ? "" : "s"}.`;
  return `${verb} Their bedroom light turns off.`;
}
