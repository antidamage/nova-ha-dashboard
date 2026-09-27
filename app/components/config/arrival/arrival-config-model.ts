import type { HouseholdPerson } from "../../../../lib/config-schema";
import type { ArrivalState, ArrivalTargetKind } from "../../../../lib/config-schema/arrivals";
import type { ArrivalEventKind } from "../../../../lib/arrivals/types";

/**
 * The Household members section's edits, as pure functions over
 * `dashboard.people`. Keeping them here means the components only render and
 * call, and every rule below is a unit test rather than a click.
 *
 * Members ARE `dashboard.people` — the same list the washing machine's
 * attribution reads. An id is derived once, from the label, and then never
 * follows the label again: the two endpoints address a person by that id, so
 * renaming someone must not silently break a shortcut calling the old one.
 */

/** Product colours for a household person's blocks. Not household data. */
export const PERSON_COLOURS = ["#22d3ee", "#e879f9", "#f97316", "#a3e635", "#60a5fa", "#facc15"];

export type ArrivalTargetOption = { kind: ArrivalTargetKind; label: string };
export type ArrivalPresetOption = { id: string; label: string; group?: string };
export type ArrivalPresets = Record<string, ArrivalPresetOption[]>;

export function personIdFromLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "person";
}

export function uniquePersonId(people: readonly HouseholdPerson[], base: string): string {
  const taken = new Set(people.map((person) => person.id));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function personColourFor(people: readonly HouseholdPerson[]): string {
  const taken = new Set(people.map((person) => person.color.toLowerCase()));
  return (
    PERSON_COLOURS.find((colour) => !taken.has(colour))
    ?? PERSON_COLOURS[people.length % PERSON_COLOURS.length]
  );
}

/** Display text: trimmed, with the runs of space a stray keypress leaves collapsed. */
export function cleanLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

export function addMember(people: readonly HouseholdPerson[], label: string): HouseholdPerson[] {
  const trimmed = cleanLabel(label);
  if (!trimmed) return [...people];
  const person: HouseholdPerson = {
    id: uniquePersonId(people, personIdFromLabel(trimmed)),
    label: trimmed,
    color: personColourFor(people),
    primary: people.length === 0,
    arrival: [],
    departure: [],
  };
  return [...people, person];
}

/** Removing the last member is refused: the list is who the endpoints know. */
export function removeMember(people: readonly HouseholdPerson[], id: string): HouseholdPerson[] {
  if (people.length <= 1) return [...people];
  const next = people.filter((person) => person.id !== id);
  if (next.length && !next.some((person) => person.primary)) next[0] = { ...next[0], primary: true };
  return next;
}

export function renameMember(
  people: readonly HouseholdPerson[],
  id: string,
  label: string,
): HouseholdPerson[] {
  const trimmed = cleanLabel(label);
  if (!trimmed) return [...people];
  return people.map((person) => (person.id === id ? { ...person, label: trimmed } : person));
}

export function setPrimaryMember(people: readonly HouseholdPerson[], id: string): HouseholdPerson[] {
  return people.map((person) => ({ ...person, primary: person.id === id }));
}

export function statesOf(person: HouseholdPerson, event: ArrivalEventKind): ArrivalState[] {
  return event === "arrival" ? person.arrival : person.departure;
}

function withStates(
  person: HouseholdPerson,
  event: ArrivalEventKind,
  states: ArrivalState[],
): HouseholdPerson {
  return event === "arrival" ? { ...person, arrival: states } : { ...person, departure: states };
}

export function addState(
  people: readonly HouseholdPerson[],
  id: string,
  event: ArrivalEventKind,
  state: ArrivalState,
): HouseholdPerson[] {
  return people.map((person) =>
    person.id === id ? withStates(person, event, [...statesOf(person, event), state]) : person,
  );
}

export function updateState(
  people: readonly HouseholdPerson[],
  id: string,
  event: ArrivalEventKind,
  index: number,
  state: ArrivalState,
): HouseholdPerson[] {
  return people.map((person) => {
    if (person.id !== id) return person;
    const next = statesOf(person, event).map((current, at) => (at === index ? state : current));
    return withStates(person, event, next);
  });
}

export function removeState(
  people: readonly HouseholdPerson[],
  id: string,
  event: ArrivalEventKind,
  index: number,
): HouseholdPerson[] {
  return people.map((person) => {
    if (person.id !== id) return person;
    return withStates(person, event, statesOf(person, event).filter((_, at) => at !== index));
  });
}

/**
 * The state an "Add state" press should create: the first target that HAS a
 * preset, with that preset. Null when nothing is selectable — the schema refuses
 * an empty presetId, so offering one would be a save that cannot succeed.
 */
export function firstAvailableState(
  targets: readonly ArrivalTargetOption[],
  presets: ArrivalPresets,
): ArrivalState | null {
  for (const target of targets) {
    const preset = presets[target.kind]?.[0];
    if (preset) return { target: target.kind, presetId: preset.id };
  }
  return null;
}

/** A stored preset id whose preset is gone is shown as missing, not blank. */
export function presetLabel(presets: ArrivalPresets, state: ArrivalState): string {
  return (
    presets[state.target]?.find((preset) => preset.id === state.presetId)?.label
    ?? `Missing preset: ${state.presetId}`
  );
}

/** Targets that offer nothing yet, for the section's explanatory line. */
export function targetsWithoutPresets(
  targets: readonly ArrivalTargetOption[],
  presets: ArrivalPresets,
): ArrivalTargetOption[] {
  return targets.filter((target) => (presets[target.kind] ?? []).length === 0);
}
