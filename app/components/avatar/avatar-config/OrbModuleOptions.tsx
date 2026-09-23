"use client";

import { appliedThemeRgb } from "../../accentColor";
import { SliderControlPanel } from "../../ConfigControls";
import { SwitchRow } from "../../SlideSwitch";
import type { NovaAvatarTheme } from "../theme-model/types";
import type { OrbModule, OrbModuleSettingDecl } from "../../../../lib/orb-modules";
import { choiceStops } from "./slot-model";
import { orbKnobToneChoice } from "./knob-tone";

/**
 * One orb module's own settings — the "Module options" group of the Status Orb
 * config.
 *
 * Three shapes, chosen by what the declaration says rather than by name:
 *
 * - a declaration naming its stops (`options`) is a CHOICE and gets the same
 *   labelled slider the theme's own mode pickers use (Knob Theme, Text Tone),
 *   captioned with the stop rather than the number;
 * - a single step from 0 to 1 is the boolean it actually is, so it gets the
 *   checkbox rather than a two-position slider;
 * - anything else is a magnitude slider.
 *
 * A choice's stop may be `auto`, which the orb resolves against the device
 * theme as it draws, so the control shows the stop while the orb shows the
 * treatment.
 */
export function OrbModuleOptions({
  module,
  values,
  theme,
  settingTheme,
  setTheme,
  previewTheme,
}: {
  module: OrbModule;
  values: Record<string, number>;
  theme: NovaAvatarTheme;
  settingTheme: (settingId: string, value: number) => NovaAvatarTheme;
  setTheme: (theme: NovaAvatarTheme) => void;
  previewTheme: (theme: NovaAvatarTheme) => void;
}) {
  // The module's light/dark knob choice is hoisted out of this group and drawn
  // beside the theme's own knob control (config/accent/OrbKnobToneControl), so
  // the group keeps to the settings only this orb has. The rule for which
  // setting that is lives next to the group's siblings in ./knob-tone.
  const hoisted = orbKnobToneChoice(module);
  const declarations = (module.settings ?? []).filter((decl) => decl.id !== hoisted?.id);
  if (declarations.length === 0) return null;

  const optionColor = appliedThemeRgb(theme.gradientOuter);
  const activeColor = appliedThemeRgb(theme.gradientAlert);

  return (
    <div className="nova-avatar-cfg-group">
      <h3 className="nova-avatar-cfg-group-title">{module.name} options</h3>
      <div className="grid gap-3">
        {declarations.map((decl) => (
          <SettingRow
            key={decl.id}
            activeColor={activeColor}
            module={module}
            optionColor={optionColor}
            value={values[decl.id]}
            decl={decl}
            previewTheme={previewTheme}
            setTheme={setTheme}
            settingTheme={settingTheme}
          />
        ))}
      </div>
    </div>
  );
}

/** One declared setting, in whichever of the three shapes it asks for. */
function SettingRow({
  activeColor,
  decl,
  module,
  optionColor,
  previewTheme,
  setTheme,
  settingTheme,
  value,
}: {
  activeColor: [number, number, number];
  decl: OrbModuleSettingDecl;
  module: OrbModule;
  optionColor: [number, number, number];
  previewTheme: (theme: NovaAvatarTheme) => void;
  setTheme: (theme: NovaAvatarTheme) => void;
  settingTheme: (settingId: string, value: number) => NovaAvatarTheme;
  value: number;
}) {
  const label = decl.description ? `${decl.label} — ${decl.description}` : `${module.name} ${decl.label}`;

  if (decl.options && decl.options.length > 0) {
    const stops = choiceStops(decl);
    const activeStop = stops.find((stop) => stop.value === value) ?? stops[0];
    const activeLabel = activeStop?.label ?? decl.label;
    return (
      <SliderControlPanel
        activeColor={activeColor}
        ariaLabel={decl.description ? `${decl.label} — ${decl.description}` : decl.label}
        ariaValueText={activeLabel}
        color={optionColor}
        intensity={100}
        label={decl.label}
        max={decl.max}
        min={decl.min}
        step={decl.step}
        value={value}
        valueText={activeLabel}
        onPreview={(next) => previewTheme(settingTheme(decl.id, next))}
        onCommit={(next) => setTheme(settingTheme(decl.id, next))}
        markers={stops.map((stop) => ({
          active: stop.value === value,
          label: stop.label,
          value: stop.value,
        }))}
      />
    );
  }

  if (decl.min === 0 && decl.max === 1 && decl.step === 1) {
    return (
      <SwitchRow
        checked={value >= 1}
        detail={decl.description}
        label={decl.label}
        onChange={(checked) => setTheme(settingTheme(decl.id, checked ? 1 : 0))}
      />
    );
  }

  return (
    <SliderControlPanel
      ariaLabel={label}
      ariaValueText={`${value}`}
      color={optionColor}
      intensity={100}
      label={decl.label}
      max={decl.max}
      min={decl.min}
      step={decl.step}
      value={value}
      valueText={`${value}`}
      onPreview={(next) => previewTheme(settingTheme(decl.id, next))}
      onCommit={(next) => setTheme(settingTheme(decl.id, next))}
    />
  );
}
