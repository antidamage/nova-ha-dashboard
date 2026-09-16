"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { DashboardEntity } from "../../../../lib/types";
import { climateCurrentTemperature, climateTargetTemperature } from "../../../../lib/aircon-control";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { classNames, formatTemperature, temperatureDelta } from "../shared";

/**
 * The +/− target stepper. The air conditioner and the bedroom heater moved to
 * the temperature knob on 2026-09-12 (specs/temperature-encoder.md); this is
 * still how the legacy panel-heater card sets its target.
 */
export function TemperatureStepper({
  currentTemperature,
  disabled = false,
  entity,
  label,
  maxTemperature,
  minTemperature,
  onChange,
  onTargetPreviewChange,
  step = 0.5,
  targetTemperature,
}: {
  currentTemperature?: number | null;
  disabled?: boolean;
  entity: DashboardEntity;
  label: string;
  /**
   * Bounds for callers whose limit is a Nova concept rather than a climate
   * entity attribute — a bare switch has no min_temp/max_temp to read, and
   * without these the readout would climb past a limit the caller then clamps.
   */
  maxTemperature?: number;
  minTemperature?: number;
  onChange: (temperature: number) => Promise<void>;
  onTargetPreviewChange?: (temperature: number) => void;
  step?: number;
  targetTemperature?: number | null;
}) {
  const serverTarget = climateTargetTemperature(entity);
  const displayedTarget = targetTemperature ?? serverTarget;
  const current = currentTemperature === undefined ? climateCurrentTemperature(entity) : currentTemperature;
  const [target, setTarget] = useState(displayedTarget);

  useEffect(() => {
    setTarget(displayedTarget);
  }, [displayedTarget, entity.entity_id]);

  const nudge = (delta: number) => {
    if (disabled) {
      return;
    }

    const stepped = temperatureDelta(entity, delta, step, target ?? displayedTarget ?? current ?? 20);
    const next = Math.min(maxTemperature ?? Infinity, Math.max(minTemperature ?? -Infinity, stepped));
    if (next === target) {
      return;
    }
    setTarget(next);
    onTargetPreviewChange?.(next);
    void onChange(next);
  };

  return (
    <div className={classNames("temperature-stepper border border-neutral-700 bg-neutral-950/70 p-4", disabled && "temperature-stepper-disabled")}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase text-cyan-300">{label}</p>
          <p className="climate-temp-readout mt-1 font-black tabular-nums text-neutral-50">
            {formatTemperature(target)}
            {target === null ? null : <span>&deg;</span>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-black uppercase text-neutral-400">Current</p>
          <p className="temp-readout climate-current-readout font-mono font-black tabular-nums text-neutral-100">
            {formatTemperature(current)}
            {current === null ? null : <span>&deg;</span>}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <MomentaryFeedbackButton
          type="button"
          className="climate-icon-button border"
          aria-label={`Lower ${label}`}
          disabled={disabled}
          onClick={() => nudge(-step)}
        >
          <Minus className="h-7 w-7" />
        </MomentaryFeedbackButton>
        <MomentaryFeedbackButton
          type="button"
          className="climate-icon-button border"
          aria-label={`Raise ${label}`}
          disabled={disabled}
          onClick={() => nudge(step)}
        >
          <Plus className="h-7 w-7" />
        </MomentaryFeedbackButton>
      </div>
    </div>
  );
}
