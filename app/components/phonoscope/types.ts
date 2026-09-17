/**
 * Phonoscope effect-picker shapes. Split out of `effectCatalogue.ts`
 * (specs/agent-token-footprint.md §4).
 */
import type {
  PhonoscopeEffectGroup,
  PhonoscopeParameterGroup,
} from "../../../lib/phonoscope-effect-groups";

export type ModuleSetting = {
  id: string;
  label: string;
  /**
   * Manifests still carry these, and the flat picker still shows them as the
   * `detail` line on a choice. They are deliberately NOT rendered as body copy
   * under the control itself.
   */
  description?: string;
  control: "slider" | "number" | "toggle" | "select";
  min: number;
  max: number;
  step: number;
  default: number;
  affects?: string[];
  curve?: { type: "linear" | "power"; exponent: number };
  options?: { label: string; value: number }[];
  section?: string;
  /** Effect group this setting joins in the editor, if its manifest named one. */
  group?: string;
  /**
   * Which parameter group inside that effect. Optional: with none named the
   * setting lands in the effect's FIRST parameter group, so `group: grid` alone
   * puts the lattice's width and height under Size. Naming one is how a setting
   * lands anywhere else — `dot_size` names `dots` so it gets its own ramp
   * rather than sharing the extents'.
   */
  parameterGroup?: string;
  updateMode: "smooth" | "structural";
};

/** One entry the "+ Add effect" picker can offer. */
export type EffectOption = {
  id: string;
  label: string;
  /**
   * How it reads inside its group, where the group heading already carries the
   * subject: "Opacity" under Glow rather than "Glow opacity". Falls back to
   * `label` for an effect that stands alone.
   */
  shortLabel?: string;
  /**
   * Only ever set for a genuinely obtuse control, and only ever one short
   * clause. Most controls carry a label and nothing else.
   */
  description?: string;
  section: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Suffix on the readout: "%" on a screen fraction, "°" on an axis. */
  unit?: string;
  /** Named positions on a discrete axis, if the numbers mean something. */
  choices?: { value: number; label: string }[];
  /** A 0/1 axis that reads as on or off, edited as a checkbox. */
  toggle?: boolean;
  /**
   * A continuous axis that is nonetheless ONE value rather than a sweep: both
   * ends of the range are pinned together and it is edited with a plain slider.
   *
   * The transition parameters are the case this exists for. They are latched
   * when the transition starts and held for its whole run, so a driver sweeping
   * the axis would only ever be sampled once — a range would be a control that
   * looks like it does something and does not.
   */
  pinned?: boolean;
  /**
   * A value another effect's control set owns, rather than an effect you add.
   *
   * The transition axis, divisions and return edge only mean anything relative
   * to the mode: an axis with no flip or slide to run on is a control for
   * nothing. So they are not offered in the picker and never render on their
   * own — the transition's own control set shows exactly the ones its current
   * mode uses, and writes them. They stay separate effect ids underneath so
   * both engines and the override resolution are unchanged.
   */
  companion?: boolean;
};

/** A parameter group resolved against one module: the parameters that exist. */
export type ResolvedParameterGroup =
  Omit<PhonoscopeParameterGroup, "effects"> & { members: EffectOption[] };

/**
 * A group resolved against one module. `parameterGroups` is the structure the
 * panel renders; `members` is the same set flattened, for the callers that only
 * need to ask whether an effect belongs to this group.
 */
export type ResolvedEffectGroup =
  Omit<PhonoscopeEffectGroup, "parameterGroups"> & {
    parameterGroups: ResolvedParameterGroup[];
    members: EffectOption[];
  };
