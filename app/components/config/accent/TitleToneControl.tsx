"use client";

import { SliderControlPanel } from "../../ConfigControls";
import type { ThemeTitleTone } from "../../theme/accent/types";
import { TITLE_TONES } from "./accent-config-model";

export function TitleToneControl({
  accentColor,
  highlightColor,
  value,
  onCommit,
  onPreview,
}: {
  accentColor: [number, number, number];
  highlightColor: [number, number, number];
  value: ThemeTitleTone;
  onCommit: (value: ThemeTitleTone) => void;
  onPreview: (value: ThemeTitleTone) => void;
}) {
  const activeIndex = Math.max(0, TITLE_TONES.findIndex((tone) => tone.value === value));
  const activeLabel = TITLE_TONES[activeIndex]?.label ?? "Auto";

  return (
    <SliderControlPanel
      activeColor={highlightColor}
      ariaLabel="Text tone"
      ariaValueText={activeLabel}
      color={accentColor}
      label="Text Tone"
      max={TITLE_TONES.length - 1}
      min={0}
      step={1}
      value={activeIndex}
      valueText={activeLabel}
      onPreview={(index) => onPreview(TITLE_TONES[Math.round(index)]?.value ?? "auto")}
      onCommit={(index) => onCommit(TITLE_TONES[Math.round(index)]?.value ?? "auto")}
      markers={TITLE_TONES.map((tone, index) => ({
        active: tone.value === value,
        label: tone.label,
        value: index,
      }))}
    />
  );
}
