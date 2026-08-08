import type {
  PhonoscopeColorTheme,
  PhonoscopeEffectBinding,
  PhonoscopeSettingsGroup,
} from "./types";
import {
  PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
  PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
  PHONOSCOPE_CENTRE_WIDTH_EFFECT,
} from "./phonoscope-drivers";
import type { PhonoscopeImage } from "./phonoscope-images";

/**
 * v6: the centre slot became width-authored, like the backdrop.
 *
 * The centre image used to be sized by its HEIGHT alone, with the width falling
 * out of the source's proportions — `halfWidth = halfHeight * imageAspect /
 * frameAspect`. The backdrop is sized by its width. Two slots doing the same
 * job by opposite rules is exactly the kind of thing nobody can hold in their
 * head, so both are now width-authored: the width slider is the one that is
 * live, and the height follows it while `__centreProportional` is on.
 *
 * That inverts the arithmetic, so a stored `__centreHeight` no longer draws the
 * picture it used to. This converts it:
 *
 *     width% = height% * imageAspect / frameAspect
 *
 * which is the old expression rearranged, with `frameAspect` taken as 16:9 —
 * the aspect every one of these values was authored while looking at.
 *
 * `__centreProportional` is stamped on rather than left to its declared default
 * because absent must not read as "the user turned this off": keeping the
 * source's proportions is what every centre image did before the axis existed,
 * and a stored configuration has to keep doing it.
 *
 * KNOWN APPROXIMATION. Effects belong to a settings GROUP; images belong to a
 * THEME. One settings group can be shared by several themes whose images are
 * different shapes, and there is only one `__centreWidth` between them. The
 * conversion therefore uses one representative aspect — the first theme that
 * has an image, in library order — which is exact for the ordinary case of a
 * group used by themes with same-shaped images, and approximate otherwise. A
 * group spanning several aspects may want one nudge of the width slider
 * afterwards; nothing is lost, it is a slider.
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
 * The aspect these values were authored against. Not read from the output: the
 * conversion is of numbers a person chose while looking at a 16:9 picture, and
 * re-deriving it from whatever the renderer happens to be running at now would
 * make the same stored configuration migrate differently on two machines.
 */
const AUTHORING_FRAME_ASPECT = 16 / 9;

/**
 * The representative image aspect, or 1 when no theme has an image at all.
 *
 * 1 rather than the frame's aspect because a square is the neutral assumption:
 * with no image to measure, width and height percentages should mean the same
 * thing, and the conversion becomes a plain rescale by the frame.
 */
export function phonoscopeMigrationImageAspect(
  themes: Pick<PhonoscopeColorTheme, "imageId">[],
  images: Pick<PhonoscopeImage, "id" | "width" | "height">[],
): number {
  const byId = new Map(images.map((image) => [image.id, image]));
  for (const theme of themes) {
    const image = theme.imageId ? byId.get(theme.imageId) : undefined;
    if (image && image.width > 0 && image.height > 0) return image.width / image.height;
  }
  return 1;
}

/** The old height percentage, as the width percentage that draws the same size. */
export function phonoscopeCentreWidthFromHeight(heightPercent: number, imageAspect: number) {
  if (!Number.isFinite(heightPercent) || !(imageAspect > 0)) return heightPercent;
  const width = heightPercent * imageAspect / AUTHORING_FRAME_ASPECT;
  // The axis is a percentage of the frame and clamps to 0-100 everywhere else;
  // a tall narrow source could otherwise convert to a width past the end of its
  // own slider, which would read as a control that cannot reach its value.
  return Math.max(0, Math.min(100, width));
}

/**
 * An absent `min`/`max` means "inherit the effect's declared default", so it
 * must stay absent rather than become an explicit undefined — the same rule
 * `phonoscope-migrate-v4.ts` follows for the percentage conversion.
 */
function convertedEndpoint(
  binding: PhonoscopeEffectBinding,
  key: "min" | "max",
  imageAspect: number,
) {
  const value = binding[key];
  return typeof value === "number" && Number.isFinite(value)
    ? { [key]: phonoscopeCentreWidthFromHeight(value, imageAspect) }
    : {};
}

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
  imageAspect: number,
): Record<string, number> {
  const next: Record<string, number> = { ...values };
  const height = next[PHONOSCOPE_CENTRE_HEIGHT_EFFECT];
  if (typeof height === "number" && Number.isFinite(height)) {
    delete next[PHONOSCOPE_CENTRE_HEIGHT_EFFECT];
    next[PHONOSCOPE_CENTRE_WIDTH_EFFECT] = phonoscopeCentreWidthFromHeight(height, imageAspect);
  }
  return next;
}

/**
 * Driver-lane bindings, whose `min`/`max` are on the effect's own axis.
 *
 * A binding is repointed at `__centreWidth` and its endpoints converted, so a
 * lane that swept the centre's height keeps sweeping the same sizes. Every
 * group also gains a pinned `__centreProportional` binding when it has none, so
 * the flag is explicit rather than inherited.
 */
export function migratePhonoscopeCentreSettingsGroups(
  groups: PhonoscopeSettingsGroup[],
  imageAspect: number,
): PhonoscopeSettingsGroup[] {
  return groups.map((group) => ({
    ...group,
    staticSettings: migratePhonoscopeCentreScalars(group.staticSettings, imageAspect),
    lanes: group.lanes.map((lane) => ({
      ...lane,
      bindings: lane.bindings.map((binding) => binding.effect === PHONOSCOPE_CENTRE_HEIGHT_EFFECT
        ? {
          ...binding,
          effect: PHONOSCOPE_CENTRE_WIDTH_EFFECT,
          ...convertedEndpoint(binding, "min", imageAspect),
          ...convertedEndpoint(binding, "max", imageAspect),
        }
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
