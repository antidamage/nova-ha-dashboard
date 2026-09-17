"use client";

import { DotLineControl } from "../../DotControls";

export function Setting({ label, min, max, step, value, onChange, onCommit }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void; onCommit: (value: number) => void;
}) {
  return (
    <div className="grid gap-2 border border-cyan-300/20 bg-neutral-900/70 p-3">
      <span className="flex justify-between text-sm font-black uppercase text-cyan-200">
        {label}<span className="font-mono text-neutral-100">{value.toFixed(2)}</span>
      </span>
      <DotLineControl
        ariaLabel={label}
        ariaValueText={value.toFixed(2)}
        min={min}
        max={max}
        step={step}
        value={value}
        fill
        onChange={onChange}
        onCommit={onCommit}
      />
    </div>
  );
}
