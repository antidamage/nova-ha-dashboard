import type { PhonoscopeEffectDeclaration } from "./phonoscope-drivers";
import type { PhonoscopeSetting } from "./phonoscope";
import { PHONOSCOPE_PICTURE_EFFECTS } from "./phonoscope-effects/picture-effects.data";

export { PHONOSCOPE_PICTURE_EFFECTS };
export { PHONOSCOPE_PICTURE_EFFECT_LABELS } from "./phonoscope-effects/picture-effect-labels.data";

const PICTURE_EFFECT_IDS = new Set(PHONOSCOPE_PICTURE_EFFECTS.map((effect) => effect.id));

export function isPicturePhonoscopeEffect(id: string) {
  return PICTURE_EFFECT_IDS.has(id);
}

/**
 * Every effect a settings group can bind for a given module: the module's own
 * driveable settings plus the picture-level ones.
 *
 * Structural settings are excluded — they rebuild the scene and cannot be
 * driven, so they are edited directly on the settings group instead.
 */
export function phonoscopeEffectDeclarations(
  moduleSettings: PhonoscopeSetting[],
): Map<string, PhonoscopeEffectDeclaration> {
  const declarations = new Map<string, PhonoscopeEffectDeclaration>();
  for (const effect of PHONOSCOPE_PICTURE_EFFECTS) declarations.set(effect.id, { ...effect });
  for (const setting of moduleSettings) {
    if (setting.updateMode === "structural") continue;
    declarations.set(setting.id, {
      id: setting.id,
      min: setting.min,
      max: setting.max,
      step: setting.step,
      default: setting.default,
    });
  }
  return declarations;
}

/** The settings a module declares that cannot be driven and must be set directly. */
export function phonoscopeStaticSettings(moduleSettings: PhonoscopeSetting[]) {
  return moduleSettings.filter((setting) => setting.updateMode === "structural");
}
