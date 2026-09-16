"use client";

import { SliderControlPanel } from "../../ConfigControls";
import {
  FLUID_BACKGROUND_APEX_GLOW_DEFAULT,
  FLUID_BACKGROUND_APEX_GLOW_MAX,
  FLUID_BACKGROUND_APEX_GLOW_MIN,
  FLUID_BACKGROUND_FALLOFF_POWER_DEFAULT,
  FLUID_BACKGROUND_FALLOFF_POWER_MAX,
  FLUID_BACKGROUND_FALLOFF_POWER_MIN,
  FLUID_BACKGROUND_HUE_SPREAD_DEFAULT,
  FLUID_BACKGROUND_HUE_SPREAD_MAX,
  FLUID_BACKGROUND_HUE_SPREAD_MIN,
  FLUID_BACKGROUND_PEAK_INTENSITY_DEFAULT,
  FLUID_BACKGROUND_PEAK_INTENSITY_MAX,
  FLUID_BACKGROUND_PEAK_INTENSITY_MIN,
  FLUID_BACKGROUND_WARP_AMPLITUDE_DEFAULT,
  FLUID_BACKGROUND_WARP_AMPLITUDE_MAX,
  FLUID_BACKGROUND_WARP_AMPLITUDE_MIN,
} from "../../accentColor";
import type { FluidBackgroundSettings } from "../../theme/accent/types";
import { BackgroundTextureControl } from "./BackgroundTextureControl";

type BackgroundEffectKey = Exclude<keyof FluidBackgroundSettings, "textureScale" | "textureUrl">;

const BACKGROUND_EFFECT_CONTROLS: Array<{
  defaultValue: number;
  key: BackgroundEffectKey;
  label: string;
  max: number;
  min: number;
  step: number;
  valueText: (value: number) => string;
}> = [
  {
    defaultValue: FLUID_BACKGROUND_PEAK_INTENSITY_DEFAULT,
    key: "peakIntensity",
    label: "Peak Intensity",
    max: FLUID_BACKGROUND_PEAK_INTENSITY_MAX,
    min: FLUID_BACKGROUND_PEAK_INTENSITY_MIN,
    step: 5,
    valueText: (value) => `${value}%`,
  },
  {
    defaultValue: FLUID_BACKGROUND_APEX_GLOW_DEFAULT,
    key: "apexGlow",
    label: "Apex Glow",
    max: FLUID_BACKGROUND_APEX_GLOW_MAX,
    min: FLUID_BACKGROUND_APEX_GLOW_MIN,
    step: 5,
    valueText: (value) => `${value}%`,
  },
  {
    defaultValue: FLUID_BACKGROUND_WARP_AMPLITUDE_DEFAULT,
    key: "warpAmplitude",
    label: "Warp Amplitude",
    max: FLUID_BACKGROUND_WARP_AMPLITUDE_MAX,
    min: FLUID_BACKGROUND_WARP_AMPLITUDE_MIN,
    step: 5,
    valueText: (value) => `${value}%`,
  },
  {
    defaultValue: FLUID_BACKGROUND_FALLOFF_POWER_DEFAULT,
    key: "falloffPower",
    label: "Falloff Power",
    max: FLUID_BACKGROUND_FALLOFF_POWER_MAX,
    min: FLUID_BACKGROUND_FALLOFF_POWER_MIN,
    step: 5,
    valueText: (value) => (value / 100).toFixed(2),
  },
  {
    defaultValue: FLUID_BACKGROUND_HUE_SPREAD_DEFAULT,
    key: "hueSpread",
    label: "Hue Drift",
    max: FLUID_BACKGROUND_HUE_SPREAD_MAX,
    min: FLUID_BACKGROUND_HUE_SPREAD_MIN,
    step: 1,
    valueText: (value) => `${value}%`,
  },
];

export function BackgroundEffectControls({
  accentColor,
  highlightColor,
  onChange,
  onPreview,
  value,
}: {
  accentColor: [number, number, number];
  highlightColor: [number, number, number];
  onChange: (value: FluidBackgroundSettings) => void;
  onPreview: (value: FluidBackgroundSettings) => void;
  value: FluidBackgroundSettings;
}) {
  return (
    <div className="grid gap-3">
      <BackgroundTextureControl
        accentColor={accentColor}
        highlightColor={highlightColor}
        value={value}
        onChange={onChange}
        onPreview={onPreview}
      />
      {BACKGROUND_EFFECT_CONTROLS.map((control) => {
        const currentValue = value[control.key];
        const displayValue = control.valueText(currentValue);

        return (
          <SliderControlPanel
            key={control.key}
            activeColor={highlightColor}
            ariaLabel={`Apple TV background ${control.label.toLowerCase()}`}
            ariaValueText={displayValue}
            color={accentColor}
            intensity={Math.min(100, Math.max(40, currentValue))}
            label={control.label}
            max={control.max}
            min={control.min}
            step={control.step}
            value={currentValue}
            valueText={displayValue}
            onPreview={(nextValue) => onPreview({ ...value, [control.key]: nextValue })}
            onCommit={(nextValue) => onChange({ ...value, [control.key]: nextValue })}
            markers={[
              { active: currentValue === control.defaultValue, label: "Default", value: control.defaultValue },
              { active: currentValue === control.max, label: "Max", value: control.max },
            ]}
          />
        );
      })}
    </div>
  );
}
