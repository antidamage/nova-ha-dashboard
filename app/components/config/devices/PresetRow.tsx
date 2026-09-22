"use client";

import { AlertTriangle, Check, ChevronRight } from "lucide-react";
import type { PresetFacts } from "./device-model";
import type { ControlPreset } from "../../../../lib/control-modules/types";

/**
 * One saved preset, as a tappable row.
 *
 * The row says four things and no more — its name, what it drives, the room it
 * serves, and whether the dashboard is showing it — because that is everything
 * needed to decide whether to open it. The editor holds the rest.
 */
export function PresetRow({
  facts,
  preset,
  onOpen,
}: {
  facts: PresetFacts;
  preset: ControlPreset;
  onOpen: () => void;
}) {
  const warnings = facts.problems.filter((problem) => problem.severity === "warning");
  const errors = facts.problems.filter((problem) => problem.severity === "error");
  return (
    <button type="button" className="preset-row" onClick={onOpen}>
      <span className="preset-row-main">
        <span className="preset-row-name">{preset.name}</span>
        <span className="preset-row-summary">{facts.summary}</span>
      </span>
      <span className="preset-row-chips">
        <span className="preset-chip">{facts.room}</span>
        {facts.placed ? (
          <span className="preset-chip preset-chip-placed">
            <Check className="h-3 w-3" aria-hidden="true" /> On the dashboard
          </span>
        ) : null}
        {errors.length || warnings.length ? (
          <span className={errors.length ? "preset-chip preset-chip-error" : "preset-chip preset-chip-warning"}>
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            {errors.length ? errors[0].message : `${warnings.length} to finish`}
          </span>
        ) : null}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-neutral-500" aria-hidden="true" />
    </button>
  );
}
