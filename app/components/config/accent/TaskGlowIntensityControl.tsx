"use client";

import { SliderControlPanel } from "../../ConfigControls";
import {
  normalizeTaskGlowIntensity,
  TASK_GLOW_INTENSITY_DEFAULT,
  TASK_GLOW_INTENSITY_MAX,
  TASK_GLOW_INTENSITY_MIN,
} from "../../accentColor";

export function TaskGlowIntensityControl({
  color,
  onCommit,
  onPreview,
  onReleased,
  value,
}: {
  color: [number, number, number];
  onCommit: (value: number) => void;
  onPreview: (value: number) => void;
  onReleased: () => void;
  value: number;
}) {
  const intensity = normalizeTaskGlowIntensity(value);

  return (
    <SliderControlPanel
      activeColor={color}
      ariaLabel="Reminder glow intensity"
      ariaValueText={`${intensity}%`}
      color={color}
      intensity={Math.min(100, intensity)}
      label="Reminder Glow"
      max={TASK_GLOW_INTENSITY_MAX}
      min={TASK_GLOW_INTENSITY_MIN}
      step={10}
      value={intensity}
      valueText={`${intensity}%`}
      onPreview={(nextValue) => onPreview(normalizeTaskGlowIntensity(nextValue))}
      onCommit={(nextValue) => {
        onCommit(normalizeTaskGlowIntensity(nextValue));
        onReleased();
      }}
      markers={[
        { active: intensity === TASK_GLOW_INTENSITY_DEFAULT, label: "Default", value: TASK_GLOW_INTENSITY_DEFAULT },
        { active: intensity === TASK_GLOW_INTENSITY_MAX, label: "Max", value: TASK_GLOW_INTENSITY_MAX },
      ]}
    />
  );
}
