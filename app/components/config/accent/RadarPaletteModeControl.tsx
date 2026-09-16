"use client";

import { SliderControlPanel } from "../../ConfigControls";
import type { RadarPaletteMode } from "../../theme/accent/types";
import { RADAR_PALETTE_MODES } from "./accent-config-model";

export function RadarPaletteModeControl({
  highColor,
  lowColor,
  value,
  onCommit,
  onPreview,
}: {
  highColor: [number, number, number];
  lowColor: [number, number, number];
  value: RadarPaletteMode;
  onCommit: (value: RadarPaletteMode) => void;
  onPreview: (value: RadarPaletteMode) => void;
}) {
  const activeIndex = Math.max(0, RADAR_PALETTE_MODES.findIndex((mode) => mode.value === value));
  const activeLabel = RADAR_PALETTE_MODES[activeIndex]?.label ?? "Spectrum";

  return (
    <SliderControlPanel
      activeColor={highColor}
      ariaLabel="Radar palette mode"
      ariaValueText={activeLabel}
      color={lowColor}
      label="Radar Palette"
      max={RADAR_PALETTE_MODES.length - 1}
      min={0}
      step={1}
      value={activeIndex}
      valueText={activeLabel}
      onPreview={(index) => onPreview(RADAR_PALETTE_MODES[Math.round(index)]?.value ?? "spectrum")}
      onCommit={(index) => onCommit(RADAR_PALETTE_MODES[Math.round(index)]?.value ?? "spectrum")}
      markers={RADAR_PALETTE_MODES.map((mode, index) => ({
        active: mode.value === value,
        label: mode.label,
        value: index,
      }))}
    />
  );
}
