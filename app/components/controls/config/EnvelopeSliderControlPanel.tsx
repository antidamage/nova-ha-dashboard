"use client";

import { DotEnvelopeControl } from "../dots/DotEnvelopeControl";
import type { EnvelopeDurations } from "../dots/types";

export function EnvelopeSliderControlPanel({
  ariaLabel,
  label = "Envelope",
  max = 12,
  onCommit,
  onPreview,
  step = 0.05,
  value,
}: {
  ariaLabel: string;
  label?: string;
  max?: number;
  onCommit: (value: EnvelopeDurations) => void;
  onPreview: (value: EnvelopeDurations) => void;
  step?: number;
  value: EnvelopeDurations;
}) {
  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      {/*
        No numeric readout column. The three thumbs already carry their own A/H/R
        labels, so a second copy of the same three values only narrowed the
        control that actually needs the width. Exact numbers are typed rather
        than read off: tapping a thumb opens the numeric field for that phase.
      */}
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">{label}</p>
        <div className="px-1">
          <DotEnvelopeControl ariaLabel={ariaLabel} max={max} step={step} value={value} onChange={onPreview} onCommit={onCommit} />
        </div>
      </div>
    </div>
  );
}
