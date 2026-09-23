"use client";

import type { NovaAvatarTheme } from "../../avatarThemeModel";
import { SliderControlPanel } from "../../ConfigControls";
import { useOrbModule } from "../../orbModules";
import { resolveOrbModuleSettings } from "../../../../lib/orb-modules";
import { orbKnobToneChoice } from "../../avatar/avatar-config/knob-tone";
import { choiceStops } from "../../avatar/avatar-config/slot-model";

/**
 * The status orb's knob light/dark choice, drawn directly under the theme's own
 * Knob Theme control.
 *
 * It belongs there rather than in the orb's "module options" group: the two are
 * the same decision one level apart — that control skins every dial, this one
 * skins the orb's knob — so side by side they read as one setting, and the orb
 * group keeps to the settings only the orb has. `orbKnobToneChoice` is the
 * shared rule that keeps this from also appearing down there.
 *
 * Only the active orb module declares this choice (the built-in Tech module
 * does), so on any other module the control is simply absent rather than dead.
 */
export function OrbKnobToneControl({
  accentColor,
  avatar,
  highlightColor,
  onCommit,
  onPreview,
}: {
  accentColor: [number, number, number];
  avatar: NovaAvatarTheme;
  highlightColor: [number, number, number];
  onCommit: (theme: NovaAvatarTheme) => void;
  onPreview: (theme: NovaAvatarTheme) => void;
}) {
  const module = useOrbModule(avatar.orbModule);
  const decl = orbKnobToneChoice(module);
  if (!decl) return null;

  const value = resolveOrbModuleSettings(module, avatar.orbModuleSettings[module.id])[decl.id];
  const stops = choiceStops(decl);
  const activeLabel = (stops.find((stop) => stop.value === value) ?? stops[0])?.label ?? decl.label;

  // Writes the one saved stop on this theme's own orb-module settings, so the
  // choice is per-variant exactly like the knob skin above it.
  const withValue = (next: number): NovaAvatarTheme => ({
    ...avatar,
    orbModuleSettings: {
      ...avatar.orbModuleSettings,
      [module.id]: { ...avatar.orbModuleSettings[module.id], [decl.id]: next },
    },
  });

  return (
    <SliderControlPanel
      activeColor={highlightColor}
      ariaLabel={decl.description ? `${decl.label} — ${decl.description}` : decl.label}
      ariaValueText={activeLabel}
      color={accentColor}
      label={decl.label}
      max={decl.max}
      min={decl.min}
      step={decl.step}
      value={value}
      valueText={activeLabel}
      onPreview={(next) => onPreview(withValue(next))}
      onCommit={(next) => onCommit(withValue(next))}
      markers={stops.map((stop) => ({
        active: stop.value === value,
        label: stop.label,
        value: stop.value,
      }))}
    />
  );
}
