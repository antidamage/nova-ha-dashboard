"use client";

import { SliderControlPanel } from "../../ConfigControls";
import { THEME_SELECTIONS } from "../../accentColor";
import type { ThemeSelection } from "../../theme/accent/types";
import { THEME_SELECTION_LABELS } from "./accent-config-model";

export function ThemeSelectionControl({
  accentColor,
  highlightColor,
  onCommit,
  onPreview,
  value,
}: {
  accentColor: [number, number, number];
  highlightColor: [number, number, number];
  onCommit: (value: ThemeSelection) => void;
  onPreview: (value: ThemeSelection) => void;
  value: ThemeSelection;
}) {
  const activeIndex = Math.max(0, THEME_SELECTIONS.findIndex((selection) => selection === value));
  const activeLabel = THEME_SELECTION_LABELS[value] ?? "Dark";

  return (
    <SliderControlPanel
      activeColor={highlightColor}
      ariaLabel="Theme selection"
      ariaValueText={activeLabel}
      color={accentColor}
      label="Theme selection"
      max={THEME_SELECTIONS.length - 1}
      min={0}
      step={1}
      value={activeIndex}
      valueText={activeLabel}
      onPreview={(index) => onPreview(THEME_SELECTIONS[Math.round(index)] ?? "dark")}
      onCommit={(index) => onCommit(THEME_SELECTIONS[Math.round(index)] ?? "dark")}
      markers={THEME_SELECTIONS.map((selection, index) => ({
        active: selection === value,
        label: THEME_SELECTION_LABELS[selection],
        value: index,
      }))}
    />
  );
}
