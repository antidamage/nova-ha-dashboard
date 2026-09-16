"use client";

import { SliderControlPanel } from "../../ConfigControls";
import { KNOB_SKIN_MODES } from "../../accentColor";
import type { KnobSkinMode } from "../../theme/accent/types";
import { KNOB_SKIN_LABELS } from "./accent-config-model";

export function KnobSkinControl({
  accentColor,
  highlightColor,
  onCommit,
  onPreview,
  value,
}: {
  accentColor: [number, number, number];
  highlightColor: [number, number, number];
  onCommit: (value: KnobSkinMode) => void;
  onPreview: (value: KnobSkinMode) => void;
  value: KnobSkinMode;
}) {
  const activeIndex = Math.max(0, KNOB_SKIN_MODES.findIndex((mode) => mode === value));
  const activeLabel = KNOB_SKIN_LABELS[value] ?? "Auto";

  return (
    <SliderControlPanel
      activeColor={highlightColor}
      ariaLabel="Knob theme"
      ariaValueText={activeLabel}
      color={accentColor}
      label="Knob Theme"
      max={KNOB_SKIN_MODES.length - 1}
      min={0}
      step={1}
      value={activeIndex}
      valueText={activeLabel}
      onPreview={(index) => onPreview(KNOB_SKIN_MODES[Math.round(index)] ?? "auto")}
      onCommit={(index) => onCommit(KNOB_SKIN_MODES[Math.round(index)] ?? "auto")}
      markers={KNOB_SKIN_MODES.map((mode, index) => ({
        active: mode === value,
        label: KNOB_SKIN_LABELS[mode],
        value: index,
      }))}
    />
  );
}
