/**
 * Resolving the catalogue into the groups the panel renders, and the indexes
 * that say where an effect sits. Split out of `effectCatalogue.ts`
 * (specs/agent-token-footprint.md §4).
 */
import { PHONOSCOPE_EFFECT_GROUPS } from "../../../lib/phonoscope-effect-groups";
import { effectOptionFor } from "./effect-catalogue-model";
import type {
  EffectOption,
  ModuleSetting,
  ResolvedEffectGroup,
  ResolvedParameterGroup,
} from "./types";

/** "Grid width" under the Grid heading is just "Width". */
function stripped(label: string, groupLabel: string) {
  const prefix = `${groupLabel.toLowerCase()} `;
  if (!label.toLowerCase().startsWith(prefix)) return undefined;
  const rest = label.slice(prefix.length);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/**
 * The groups on offer for this module, each resolved to its present parameters
 * in display order: the module's own settings that named the group (manifest
 * order) first, then the picture-level ones.
 *
 * A group whose parameters are all absent — `grid` under a module with no
 * lattice — is not offered at all rather than appearing empty, and neither is
 * an empty parameter group inside one that survives.
 */
export function effectGroups(
  catalogue: EffectOption[],
  moduleSettings: ModuleSetting[],
): ResolvedEffectGroup[] {
  return PHONOSCOPE_EFFECT_GROUPS.flatMap((group) => {
    // A manifest names the effect group, not necessarily the parameter group
    // inside it, so a setting that names none lands in the first one — which is
    // the geometry group in every case that exists. Naming one overrides that.
    //
    // `||`, not `??`: the compiler normalises an absent `parameterGroup` to the
    // EMPTY STRING, not to undefined, and `"" ?? fallback` is `""`. With `??`
    // every setting relying on the fallback matched no parameter group at all
    // and silently left its effect group — which is how `grid_width` and
    // `grid_height` fell out of Grid/Size, leaving `dot_size` as the group's
    // first member and therefore the thing "add Grid" added.
    const defaultParameterGroup = group.parameterGroups[0]?.id;
    const parameterGroups = group.parameterGroups.flatMap((parameters) => {
      const fromModule = moduleSettings
        .filter((setting) => setting.group === group.id
          && setting.updateMode !== "structural"
          && (setting.parameterGroup || defaultParameterGroup) === parameters.id)
        .flatMap((setting) => {
          const option = effectOptionFor(catalogue, setting.id);
          if (!option) return [];
          // A module names its settings for the flat picker ("Grid width"),
          // where the subject has to be in the label. Inside the group the
          // heading already says it, so strip the prefix rather than making
          // every manifest carry a second label.
          return [{
            ...option,
            shortLabel: option.shortLabel ?? stripped(option.label, group.label),
            // Member unit, then the group's, then the `moduleSingleValue`
            // shorthand for a percentage.
            unit: option.unit
              ?? parameters.unit
              ?? (parameters.moduleSingleValue ? "%" : undefined),
            pinned: option.pinned || parameters.moduleSingleValue,
          }];
        });
      const fromPicture = parameters.effects
        .flatMap((id) => effectOptionFor(catalogue, id) ?? []);
      const members = [...fromModule, ...fromPicture];
      if (!members.length) return [];
      const { effects: _declared, ...rest } = parameters;
      return [{ ...rest, members }];
    });
    const members = parameterGroups.flatMap((parameters) => parameters.members);
    if (!members.length) return [];
    const { parameterGroups: _declared, ...rest } = group;
    return [{ ...rest, parameterGroups, members }];
  });
}

/** Where each effect id sits, so a lane can be partitioned into groups. */
export function effectGroupIndex(groups: ResolvedEffectGroup[]) {
  return new Map(groups.flatMap((group) =>
    group.members.map((member) => [member.id, group.id] as const)));
}

/** Which parameter group inside its effect an effect id belongs to. */
export function parameterGroupIndex(groups: ResolvedEffectGroup[]) {
  return new Map(groups.flatMap((group) => group.parameterGroups.flatMap((parameters) =>
    parameters.members.map((member) => [member.id, parameters.id] as const))));
}
