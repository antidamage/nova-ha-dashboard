import type {
  PhonoscopeDriver,
  PhonoscopeDriverType,
  PhonoscopeEffectBinding,
} from "../../../lib/types";
import {
  PHONOSCOPE_PICTURE_EFFECTS,
  PHONOSCOPE_PICTURE_EFFECT_LABELS,
} from "../../../lib/phonoscope-effects";
import {
  PHONOSCOPE_EFFECT_GROUPS,
  PHONOSCOPE_SINGLE_VALUE_EFFECTS,
  type PhonoscopeEffectGroup,
  type PhonoscopeParameterGroup,
} from "../../../lib/phonoscope-effect-groups";
import {
  PHONOSCOPE_GLOW_BLEND_EFFECT,
  PHONOSCOPE_SCENE_BLEND_EFFECT,
  PHONOSCOPE_GLOW_CLAMP_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_CENTRE_FIT_EFFECT,
  PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
  PHONOSCOPE_BG_FIT_EFFECT,
  PHONOSCOPE_BG_PROPORTIONAL_EFFECT,
  PHONOSCOPE_BG_TRANSITION_EFFECT,
  PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT,
  driverFiresEvents,
  isPhonoscopeThemePulseEffect,
} from "../../../lib/phonoscope-drivers";

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
   * setting lands in the effect's first parameter group, which is the geometry
   * one, so `group: grid` alone puts the lattice's width and height under Size.
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

const PICTURE_SECTION = "Picture";

/**
 * The blend axis is 0 screen, 1 multiply, 2 overlay and is append-only, so the
 * numbers are fixed. Only the presentation order is a matter of taste, and this
 * is the order the modes are listed in.
 */
export const GLOW_BLEND_CHOICES = [
  { value: 0, label: "Screen" },
  { value: 2, label: "Overlay" },
  { value: 1, label: "Multiply" },
];

/**
 * The scene blend axis is its own, separate from the glow's: 0 linear, 1 screen,
 * 2 overlay, 3 multiply, likewise append-only. Linear is the original composite
 * term, so it leads — picking it is picking "leave the picture alone".
 */
export const SCENE_BLEND_CHOICES = [
  { value: 0, label: "Linear" },
  { value: 1, label: "Screen" },
  { value: 2, label: "Overlay" },
  { value: 3, label: "Multiply" },
];

/**
 * How an image changes: 0 cross-fade, 1 flip, 2 slide, append-only. Cross-fade
 * leads because it is 0 and it is what the picture did before the other two
 * existed. Shared by the centre and the background, which have identical modes
 * on separate axes — so it is not named for either of them.
 */
export const IMAGE_TRANSITION_CHOICES = [
  { value: 0, label: "Cross-fade" },
  { value: 1, label: "Flip" },
  { value: 2, label: "Slide" },
];

/**
 * How an image is sized: 0 manual, 1 fit to screen, 2 fill screen, append-only.
 * Manual leads because it is 0 and it is the width and height the sliders under
 * it state — the other two derive both from the image and hide them.
 */
export const IMAGE_FIT_CHOICES = [
  { value: 0, label: "Manual" },
  { value: 1, label: "Fit to screen" },
  { value: 2, label: "Fill screen" },
];

export type TransitionCompanion = { id: string; minimumMode: number };

/**
 * The three axes a transition's control set owns, and which mode each needs.
 *
 * Cross-fade uses none of them, a flip runs on the axis, and only a slide can
 * be divided or sent back the way it came.
 */
export const CENTRE_TRANSITION_COMPANIONS: TransitionCompanion[] = [
  { id: PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT, minimumMode: 1 },
  { id: PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT, minimumMode: 2 },
  { id: PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT, minimumMode: 2 },
];

/** The background image's, with the same modes and therefore the same rule. */
export const BACKGROUND_TRANSITION_COMPANIONS: TransitionCompanion[] = [
  { id: PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT, minimumMode: 1 },
  { id: PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT, minimumMode: 2 },
  { id: PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT, minimumMode: 2 },
];

/**
 * Which control set owns which companions, keyed by the mode axis that shows
 * them. Two slots, identical rules, so the lookup is by mode rather than the
 * centre's list being the one everything reaches for.
 */
const TRANSITION_COMPANIONS = new Map<string, TransitionCompanion[]>([
  [PHONOSCOPE_CENTRE_TRANSITION_EFFECT, CENTRE_TRANSITION_COMPANIONS],
  [PHONOSCOPE_BG_TRANSITION_EFFECT, BACKGROUND_TRANSITION_COMPANIONS],
]);

export function transitionCompanionsFor(modeEffect: string): TransitionCompanion[] {
  return TRANSITION_COMPANIONS.get(modeEffect) ?? [];
}

const COMPANION_IDS = new Set(
  [...TRANSITION_COMPANIONS.values()].flat().map((companion) => companion.id));

/** True for a value some other effect's control set owns. */
export function isCompanionEffect(id: string) {
  return COMPANION_IDS.has(id);
}

function titleCase(value: string) {
  const cleaned = value.replace(/[-_]+/g, " ").trim();
  if (!cleaned) return "General";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Every effect a settings group can bind for this module: the picture-level
 * ones plus the module's own driveable settings. Structural settings are
 * excluded — they rebuild the scene and are edited directly on the group.
 */
export function effectCatalogue(moduleSettings: ModuleSetting[]): EffectOption[] {
  const picture = PHONOSCOPE_PICTURE_EFFECTS.map((effect) => ({
    id: effect.id,
    label: PHONOSCOPE_PICTURE_EFFECT_LABELS[effect.id]?.label ?? effect.id,
    shortLabel: PHONOSCOPE_PICTURE_EFFECT_LABELS[effect.id]?.shortLabel,
    description: PHONOSCOPE_PICTURE_EFFECT_LABELS[effect.id]?.description,
    section: PICTURE_SECTION,
    min: effect.min,
    max: effect.max,
    step: effect.step,
    default: effect.default,
    choices:
      effect.id === PHONOSCOPE_GLOW_BLEND_EFFECT
        ? GLOW_BLEND_CHOICES
        : effect.id === PHONOSCOPE_SCENE_BLEND_EFFECT
          ? SCENE_BLEND_CHOICES
          : effect.id === PHONOSCOPE_CENTRE_TRANSITION_EFFECT
            || effect.id === PHONOSCOPE_BG_TRANSITION_EFFECT
            ? IMAGE_TRANSITION_CHOICES
            : effect.id === PHONOSCOPE_CENTRE_FIT_EFFECT
              || effect.id === PHONOSCOPE_BG_FIT_EFFECT
              ? IMAGE_FIT_CHOICES
              : undefined,
    unit: PHONOSCOPE_SINGLE_VALUE_EFFECTS.has(effect.id)
      ? "%"
      : effect.id === PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT
        || effect.id === PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT
        ? "°"
        : undefined,
    toggle: effect.id === PHONOSCOPE_GLOW_CLAMP_EFFECT
      || effect.id === PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT
      || effect.id === PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT
      || effect.id === PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT
      || effect.id === PHONOSCOPE_BG_PROPORTIONAL_EFFECT,
    // A width is one number, not a sweep between two, so it is a plain slider
    // exactly as a latched transition axis is.
    pinned: effect.id === PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT
      || effect.id === PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT
      || effect.id === PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT
      || effect.id === PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT
      || PHONOSCOPE_SINGLE_VALUE_EFFECTS.has(effect.id),
    companion: isCompanionEffect(effect.id),
  }));
  const module = moduleSettings
    .filter((setting) => setting.updateMode !== "structural")
    .map((setting) => ({
      id: setting.id,
      label: setting.label,
      description: setting.description,
      section: titleCase(setting.section ?? "General"),
      min: setting.min,
      max: setting.max,
      step: setting.step,
      default: setting.default,
    }));
  return [...picture, ...module];
}

export function effectOptionFor(catalogue: EffectOption[], id: string) {
  return catalogue.find((effect) => effect.id === id);
}

/**
 * A newly added effect, carrying the controls that ARE its control.
 *
 * An empty binding is legal — every unset field inherits the effect's
 * declaration — but it puts an effect on screen with nothing in it, which reads
 * as a broken row rather than as an invitation to add parameters. So an added
 * effect arrives with the parameters that make it editable: the axis it runs
 * on, and the ramp it takes to get there.
 *
 * Which ones those are is decided exactly as `EffectEntry` decides what it can
 * still offer, so adding an effect and adding every parameter by hand produce
 * the same binding:
 *
 * - A toggle or a discrete choice is pinned to its default: it is a state, not
 *   something a driver sweeps, and it takes no envelope because it cuts.
 * - A rotation pulse has no range at all — a firing is an instruction — but it
 *   keeps the envelope, which is its cross-fade.
 * - Anything else gets its full declared range and the standard envelope, which
 *   is what an unset binding already resolves to.
 */
export function newEffectBinding(id: string, effect: EffectOption): PhonoscopeEffectBinding {
  const binding: PhonoscopeEffectBinding = { id, effect: effect.id };
  // A pinned axis is discrete in every way that matters here: it is one chosen
  // value, it takes no envelope, and both ends of its range sit on it.
  const discrete = Boolean(effect.choices) || Boolean(effect.toggle) || Boolean(effect.pinned);
  if (!isPhonoscopeThemePulseEffect(effect.id)) {
    binding.min = discrete ? effect.default : effect.min;
    binding.max = discrete ? effect.default : effect.max;
  }
  // The transition is discrete — it cuts between modes — but its envelope is
  // not a shape the mode takes: it is the ramp the transition itself runs on,
  // and every transition has one. So it is the one discrete effect that arrives
  // carrying an envelope.
  if (!discrete || effect.id === PHONOSCOPE_CENTRE_TRANSITION_EFFECT
    || effect.id === PHONOSCOPE_BG_TRANSITION_EFFECT) {
    binding.attackSeconds = 0.05;
    binding.holdSeconds = 0;
    binding.releaseSeconds = 0.6;
  }
  return binding;
}

/** "Grid width" under the Grid heading is just "Width". */
function stripped(label: string, groupLabel: string) {
  const prefix = `${groupLabel.toLowerCase()} `;
  if (!label.toLowerCase().startsWith(prefix)) return undefined;
  const rest = label.slice(prefix.length);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

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
    // A manifest names the effect group, not the parameter group inside it, so
    // its settings land in the first one — which is the geometry group in every
    // case that exists. Naming one explicitly overrides that.
    const defaultParameterGroup = group.parameterGroups[0]?.id;
    const parameterGroups = group.parameterGroups.flatMap((parameters) => {
      const fromModule = moduleSettings
        .filter((setting) => setting.group === group.id
          && setting.updateMode !== "structural"
          && (setting.parameterGroup ?? defaultParameterGroup) === parameters.id)
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
            unit: option.unit ?? (parameters.moduleSingleValue ? "%" : undefined),
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

export const DRIVER_TYPES: PhonoscopeDriverType[] = [
  "beat", "downbeat", "timer", "song", "energy", "bass", "mid", "treble", "random",
];

const DRIVER_LABELS: Record<PhonoscopeDriverType, string> = {
  beat: "Beat",
  downbeat: "Downbeat",
  timer: "Timer",
  song: "Song",
  energy: "Energy",
  bass: "Bass",
  mid: "Mid",
  treble: "Treble",
  random: "Random",
};

/** The `every` choices. Ordinals read better than raw numbers on a cycle. */
export const EVERY_CHOICES = [1, 2, 3, 4, 6, 8, 12, 16];

/** The subdivisions, fastest first, as they read in the cadence list. */
export const DIVIDE_CHOICES: { divide: number; label: string }[] = [
  { divide: 8, label: "Eighth" },
  { divide: 4, label: "Quarter" },
  { divide: 2, label: "Half" },
];

/** The pulse a counted driver counts, as a noun: beats, or bars. */
export function driverPulseNoun(driver: PhonoscopeDriver) {
  const type = driver.type === "random" ? driver.cadence : driver.type;
  return type === "downbeat" ? "bar" : "beat";
}

/**
 * The single cadence list: subdivisions of the pulse, then the pulse itself,
 * then multiples of it. One control rather than two because they are one
 * question — how often — asked in two directions, and a list that runs
 * continuously from "eighth beat" to "every 16th" reads as that one question.
 *
 * Each option carries the `every`/`divide` pair it means, so the row never has
 * to reconstruct one from the other.
 */
export function cadenceChoices(driver: PhonoscopeDriver) {
  const noun = driverPulseNoun(driver);
  const subdivisions = driverSupportsDivide(driver)
    ? DIVIDE_CHOICES.map(({ divide, label }) => ({
        value: `1/${divide}`,
        label: `${label} ${noun}`,
        every: 1,
        divide,
      }))
    : [];
  return [
    ...subdivisions,
    ...EVERY_CHOICES.map((every) => ({
      value: String(every),
      label: every === 1 ? "Every one" : ordinal(every),
      every,
      divide: 1,
    })),
  ];
}

/** Which cadence option a driver currently sits on. */
export function cadenceValue(driver: PhonoscopeDriver) {
  return driver.divide > 1 ? `1/${driver.divide}` : String(driver.every);
}

export function ordinal(value: number) {
  const remainderTen = value % 10;
  const remainderHundred = value % 100;
  if (remainderTen === 1 && remainderHundred !== 11) return `${value}st`;
  if (remainderTen === 2 && remainderHundred !== 12) return `${value}nd`;
  if (remainderTen === 3 && remainderHundred !== 13) return `${value}rd`;
  return `${value}th`;
}

export function driverTypeLabel(type: PhonoscopeDriverType) {
  return DRIVER_LABELS[type] ?? type;
}

/**
 * How a lane reads in its collapsed header — "Every 4th downbeat, from the 2nd",
 * "Timer · 8.0s", "Downbeat + Bass".
 */
export function driverLabel(driver: PhonoscopeDriver): string {
  const base = driverTypeLabel(driver.type);
  if (driver.type === "timer") {
    const suffix = driver.every > 1 ? `, every ${ordinal(driver.every)}` : "";
    return `Timer · ${driver.intervalSeconds.toFixed(1)}s${suffix}`;
  }
  if (driver.type === "random") {
    // "Within" rather than "on": the fire lands somewhere inside the window,
    // not at its edge, and `every` widens that window rather than skipping it.
    if (driver.divide > 1) return `Random within each ${subdivisionLabel(driver).toLowerCase()}`;
    const noun = driverTypeLabel(driver.cadence).toLowerCase();
    return driver.every > 1
      ? `Random within every ${driver.every} ${noun}s`
      : `Random within each ${noun}`;
  }
  if (driver.type !== "beat" && driver.type !== "downbeat" && driver.type !== "song") {
    return base;
  }
  // A subdivided lane is faster than the pulse it names, so the subdivision is
  // the whole story — there is no cycle left to offset within.
  if (driver.divide > 1) return subdivisionLabel(driver);
  if (driver.every <= 1) return base;
  const cycle = `Every ${ordinal(driver.every)} ${base.toLowerCase()}`;
  return driver.offset > 0 ? `${cycle}, from the ${ordinal(driver.offset + 1)}` : cycle;
}

export function laneLabel(driver: PhonoscopeDriver, modifiers: PhonoscopeDriver[]) {
  const extra = modifiers.map((modifier) => driverTypeLabel(modifier.type)).join(" + ");
  return extra ? `${driverLabel(driver)} + ${extra}` : driverLabel(driver);
}

/** "Quarter beat", "Half bar" — how a subdivided driver reads. */
export function subdivisionLabel(driver: PhonoscopeDriver) {
  const named = DIVIDE_CHOICES.find((choice) => choice.divide === driver.divide);
  return `${named?.label ?? `1/${driver.divide}`} ${driverPulseNoun(driver)}`;
}

/**
 * Only the two musical pulses subdivide. A song cannot be cut in half, and a
 * timer's interval is already a free-running number — halving it is what the
 * interval slider is for.
 */
export function driverSupportsDivide(driver: PhonoscopeDriver) {
  const type = driver.type === "random" ? driver.cadence : driver.type;
  return type === "beat" || type === "downbeat";
}

/** `every`/`offset` only mean anything on a counted pulse. */
export function driverSupportsCycle(driver: PhonoscopeDriver) {
  // On `random` the pair sizes the window it fires somewhere inside rather than
  // selecting which pulses count, but it is the same two controls either way.
  return driverFiresEvents(driver);
}

/**
 * A level driver carries no discrete event, so it can never advance the colour
 * rotation or flip the alt state. The editor says so rather than letting the
 * binding sit there inert.
 */
export function effectNeedsPulseDriver(effectId: string) {
  return isPhonoscopeThemePulseEffect(effectId);
}
