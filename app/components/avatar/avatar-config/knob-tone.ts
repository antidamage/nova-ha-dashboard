"use client";

import type { OrbModule, OrbModuleSettingDecl } from "../../../../lib/orb-modules";

/**
 * The orb module's light/dark knob choice, if it declares one — a setting whose
 * stops name a dark one.
 *
 * It lives here, rather than being looked up twice, because TWO surfaces ask:
 * `../config/accent/OrbKnobToneControl` draws it beside the theme's own Knob
 * Theme control, and `avatar-config/OrbModuleOptions` skips it so it is never
 * shown in two places at once. Modules with no such choice (classic, halo,
 * reactor, cross) return undefined, and neither surface draws anything.
 */
export function orbKnobToneChoice(module: OrbModule): OrbModuleSettingDecl | undefined {
  return (module.settings ?? []).find((decl) =>
    (decl.options ?? []).some((option) => option.toLowerCase() === "dark"));
}
