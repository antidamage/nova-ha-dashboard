import type { PhonoscopeSettingsGroup } from "./types";
import {
  PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
  PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
  PHONOSCOPE_CENTRE_WIDTH_EFFECT,
} from "./phonoscope-drivers";

/**
 * v6: the centre slot became width-authored, like the backdrop.
 *
 * The centre image used to be sized by its HEIGHT alone, with the width falling
 * out of the source's proportions. The backdrop is sized by its width. Two
 * slots doing the same job by opposite rules is exactly the kind of thing
 * nobody can hold in their head, so both are now width-authored: the width
 * slider is the one that is live, and the height follows it while
 * `__centreProportional` is on.
 *
 * The stored number is carried across UNCHANGED. The width slider says what the
 * user put on it and nothing else — it is never derived from the shape of
 * whatever image a theme happens to name — so there is no arithmetic here to
 * "preserve the drawn size", only a rename of the axis that is authored. A
 * configuration that wants a different width after this gets one nudge of the
 * slider; that is all a slider ever was.
 *
 * `__centreProportional` is stamped on rather than left to its declared default
 * because absent must not read as "the user turned this off": keeping the
 * source's proportions is what every centre image did before the axis existed,
 * and a stored configuration has to keep doing it.
 *
 * Keyed off `schemaVersion` like v4 and v5, for the same reason both of them
 * are: a converted value is a legitimate value on the old scale too, so there
 * is no way to sniff "already migrated" after the fact.
 */
export const PHONOSCOPE_WIDTH_AUTHORED_VERSION = 6;

/**
 * The version a write stamps: the newest conversion there is.
 *
 * Separate from the gate above even though they are equal today, because they
 * are different facts — one is "what this file converts below", the other is
 * "what the stored shape now is" — and the next migration moves only the
 * second.
 */
export const PHONOSCOPE_SCHEMA_VERSION = PHONOSCOPE_WIDTH_AUTHORED_VERSION;

/**
 * Resting values held directly, keyed by effect id.
 *
 * The old `__centreHeight` is REPOINTED at `__centreWidth` rather than copied:
 * leaving it in place would mean a configuration that looks like it authored
 * both axes, and the moment Proportional were unticked the stale height would
 * take effect and the image would jump.
 */
export function migratePhonoscopeCentreScalars(
  values: Record<string, number>,
): Record<string, number> {
  const next: Record<string, number> = { ...values };
  const height = next[PHONOSCOPE_CENTRE_HEIGHT_EFFECT];
  if (typeof height === "number" && Number.isFinite(height)) {
    delete next[PHONOSCOPE_CENTRE_HEIGHT_EFFECT];
    next[PHONOSCOPE_CENTRE_WIDTH_EFFECT] = height;
  }
  return next;
}

/**
 * Driver-lane bindings, whose `min`/`max` are on the effect's own axis.
 *
 * A binding is repointed at `__centreWidth` with its endpoints left exactly as
 * they were authored: the sweep is between two numbers the user set, and those
 * numbers are the whole story on the new axis too.
 */
export function migratePhonoscopeCentreSettingsGroups(
  groups: PhonoscopeSettingsGroup[],
): PhonoscopeSettingsGroup[] {
  return groups.map((group) => ({
    ...group,
    staticSettings: migratePhonoscopeCentreScalars(group.staticSettings),
    lanes: group.lanes.map((lane) => ({
      ...lane,
      bindings: lane.bindings.map((binding) => binding.effect === PHONOSCOPE_CENTRE_HEIGHT_EFFECT
        ? { ...binding, effect: PHONOSCOPE_CENTRE_WIDTH_EFFECT }
        : binding),
    })),
    // `combine` is keyed by effect id, so the old key would name an effect the
    // group no longer binds and the new one would fall back to the default.
    combine: Object.fromEntries(Object.entries(group.combine).map(([effect, mode]) =>
      [effect === PHONOSCOPE_CENTRE_HEIGHT_EFFECT ? PHONOSCOPE_CENTRE_WIDTH_EFFECT : effect,
        mode])),
  }));
}

/**
 * The proportional flag, stamped on the household's resting values.
 *
 * On the STRUCTURAL scalars rather than per group: it is one answer for the
 * picture, every stored configuration wants the same one, and adding a pinned
 * binding to every settings group would put a row in every card to say what the
 * default already says.
 */
export function migratePhonoscopeProportionalDefault(values: Record<string, number>) {
  if (PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT in values) return values;
  return { ...values, [PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT]: 1 };
}
