import type { HouseholdPerson } from "../config-schema";
import type { ArrivalState } from "../config-schema/arrivals";
import type { ArrivalEventKind } from "./types";

/**
 * Household members are `dashboard.people`: one list, defined in config (this
 * house's copy lives in the household package), shared with the power
 * attribution that reads it for the washing machine. `<name>` is matched against
 * the id or the label, so a URL can name someone either way and mean the same
 * person, and a name that matches nothing resolves to null rather than to the
 * closest candidate.
 */
export function findHouseholdMember(
  people: readonly HouseholdPerson[],
  name: string,
): HouseholdPerson | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  return (
    people.find(
      (person) =>
        person.id.toLowerCase() === wanted || person.label.toLowerCase() === wanted,
    ) ?? null
  );
}

/** The names a caller may use, for the 404 body. */
export function householdMemberNames(people: readonly HouseholdPerson[]): string[] {
  return people.map((person) => person.label);
}

export function arrivalStatesFor(person: HouseholdPerson, event: ArrivalEventKind): ArrivalState[] {
  return event === "arrival" ? person.arrival : person.departure;
}
