"use client";

import { Check } from "lucide-react";
import { DotRangeControl } from "../dots/DotRangeControl";

/**
 * The `RND` tag: a compact checkbox with its three-letter label above it.
 *
 * Deliberately the same visual family as the envelope thumbs' ATK/HLD/REL tags
 * — same 9px uppercase muted type — because it answers the same kind of
 * question about the same kind of control, and it has to stay out of the way of
 * the slider it annotates.
 */
function RandomTargetToggle({
  checked,
  hint,
  onChange,
}: {
  checked: boolean;
  hint: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className="flex cursor-pointer flex-col items-center gap-1 justify-self-center md:justify-self-end"
      title={hint}
    >
      <span className="rect-envelope-tag" aria-hidden="true">RND</span>
      <input
        type="checkbox"
        className="cyber-mini-checkbox-input"
        checked={checked}
        aria-label={hint}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="cyber-mini-checkbox" aria-hidden="true">
        <Check className="h-3 w-3" strokeWidth={3.5} />
      </span>
    </label>
  );
}

export function RangeSliderControlPanel({
  ariaLabel,
  formatValue,
  label,
  max,
  min,
  onCommit,
  onPreview,
  onRandomChange,
  random = false,
  step,
  value,
}: {
  ariaLabel: string;
  formatValue: (value: number) => string;
  label: string;
  max: number;
  min: number;
  onCommit: (value: [number, number]) => void;
  onPreview: (value: [number, number]) => void;
  /** Supply to offer the RND tag; omit and the column is not rendered at all. */
  onRandomChange?: (random: boolean) => void;
  random?: boolean;
  step: number;
  value: [number, number];
}) {
  // The readout keeps its width; the tag takes only what it needs, so adding it
  // narrows nothing.
  const columns = onRandomChange
    ? "md:grid-cols-[140px_minmax(0,1fr)_180px_auto]"
    : "md:grid-cols-[140px_minmax(0,1fr)_180px]";
  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className={`grid gap-4 ${columns} md:items-center`}>
        <p className="text-sm font-black uppercase text-cyan-200">{label}</p>
        <div className="px-1">
          <DotRangeControl
            ariaLabel={ariaLabel}
            ariaValueText={(current) => [formatValue(current[0]), formatValue(current[1])]}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={onPreview}
            onCommit={onCommit}
          />
        </div>
        <p className="config-slider-value text-xl font-black tabular-nums text-neutral-50 md:text-right">
          {formatValue(value[0])}–{formatValue(value[1])}
        </p>
        {onRandomChange ? (
          <RandomTargetToggle
            checked={random}
            hint="Pick a random target inside this range each time the lane fires"
            onChange={onRandomChange}
          />
        ) : null}
      </div>
    </div>
  );
}
