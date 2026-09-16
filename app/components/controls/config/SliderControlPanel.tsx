"use client";

import type { ReactNode } from "react";
import { DotLineControl } from "../dots/DotLineControl";
import type { DotLineMarker } from "./types";

export function SliderControlPanel({
  activeColor,
  ariaLabel,
  ariaValueText,
  color,
  dotOpacity,
  fill,
  intensity,
  label,
  markers,
  max,
  min,
  onCommit,
  onPreview,
  snapRemote,
  snapTolerance,
  snapValue,
  step,
  value,
  valueText,
}: {
  activeColor?: [number, number, number];
  ariaLabel: string;
  ariaValueText: string;
  color: [number, number, number];
  dotOpacity?: number;
  /**
   * Tinted accent back-fill up to the thumb. Left unset it follows the control:
   * on for a magnitude, off for a choice. A slider is a choice when **every**
   * one of its stops is named — `markers.length` equals the number of steps —
   * which is how the theme, knob-skin, title-tone and radar-palette pickers are
   * built. Filling one of those read as "more of something" when the stops are
   * only different things (Adeline, 2026-09-12). A magnitude with a couple of
   * landmark markers (Reminder Glow, Volume) keeps its fill. Pass the prop to
   * override either way.
   */
  fill?: boolean;
  intensity?: number;
  label: string;
  markers?: DotLineMarker[];
  max: number;
  min: number;
  onCommit: (value: number) => void;
  onPreview: (value: number) => void;
  /**
   * Show incoming values immediately instead of easing the thumb toward them.
   *
   * `DotLineControl` eases by default, which is right for a control backed by a
   * device that fades toward what it was told. It is wrong for one backed by
   * stored configuration, where there is no fade for the animation to represent
   * and the travel just reads as the slider moving on its own.
   */
  snapRemote?: boolean;
  /** Magnetic zone around `snapValue`, in value units. */
  snapTolerance?: number;
  /** A fixed value (e.g. the default) the slider snaps to on drag. */
  snapValue?: number;
  step: number;
  value: number;
  valueText: ReactNode;
}) {
  const stops = step > 0 ? Math.round((max - min) / step) + 1 : 0;
  const isChoice = markers !== undefined && stops > 0 && markers.length === stops;
  const showFill = fill ?? !isChoice;

  // Config contract: onPreview is local UI state only; onCommit is the single
  // persistence boundary fired by DotLineControl on pointer/key release. Keeping
  // both required makes save-on-drag wiring a compile-time error at every use.
  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_112px] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">{label}</p>
        <div className="px-1">
          <DotLineControl
            ariaLabel={ariaLabel}
            ariaValueText={ariaValueText}
            value={value}
            min={min}
            max={max}
            step={step}
            color={color}
            activeColor={activeColor}
            demoTooltipTitle={label}
            demoTooltip="Drag to adjust this setting, or tap it to type a value."
            dotOpacity={dotOpacity}
            fill={showFill}
            intensity={intensity}
            markers={markers}
            numericEntryLabel={label}
            snapRemote={snapRemote}
            snapTolerance={snapTolerance}
            snapValue={snapValue}
            onChange={onPreview}
            onCommit={onCommit}
          />
        </div>
        <p className="config-slider-value text-3xl font-black tabular-nums text-neutral-50 md:text-right">
          {valueText}
        </p>
      </div>
    </div>
  );
}
