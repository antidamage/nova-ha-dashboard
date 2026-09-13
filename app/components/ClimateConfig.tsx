"use client";

import { Thermometer } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CLIMATE_TARGET_RANGE_MAX,
  CLIMATE_TARGET_RANGE_MIN,
  CLIMATE_TARGET_RANGE_STEP,
  normalizeClimateTargetRange,
} from "../../lib/climate-preferences";
import { ConfigAccordion, RangeSliderControlPanel } from "./ConfigControls";
import { useSettingCooldown } from "./useSettingCooldown";

const FULL_RANGE: [number, number] = [CLIMATE_TARGET_RANGE_MIN, CLIMATE_TARGET_RANGE_MAX];

/** The household "Knob range" for every temperature knob (specs/temperature-encoder.md). */
export function ClimateConfig() {
  const [range, setRange] = useState<[number, number]>(FULL_RANGE);
  const draggingRef = useRef(false);
  const { isCoolingDown, markInteraction } = useSettingCooldown();

  const load = useCallback(async () => {
    if (draggingRef.current || isCoolingDown()) return;
    try {
      const response = await fetch("/api/climate-range", { cache: "no-store" });
      if (!response.ok) throw new Error(`Knob range request failed: ${response.status}`);
      const data = (await response.json()) as { range?: { min: number; max: number } | null };
      if (!draggingRef.current && !isCoolingDown()) {
        setRange(data.range ? [data.range.min, data.range.max] : FULL_RANGE);
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load the knob range", error);
    }
  }, [isCoolingDown]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(id);
  }, [load]);

  const commit = useCallback(
    async ([min, max]: [number, number]) => {
      draggingRef.current = false;
      markInteraction();
      const next = normalizeClimateTargetRange({ min, max });
      setRange([next.min, next.max]);
      try {
        const response = await fetch("/api/climate-range", {
          body: JSON.stringify(next),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (!response.ok) throw new Error(`Knob range update failed: ${response.status}`);
      } catch (error) {
        console.error("[nova-dashboard] failed to save the knob range", error);
      }
    },
    [markInteraction],
  );

  return (
    <ConfigAccordion
      id="climate"
      title="Climate"
      icon={<Thermometer className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />
      <RangeSliderControlPanel
        ariaLabel="Temperature knob range"
        formatValue={(value) => `${value.toFixed(1)}°C`}
        label="Knob range"
        max={CLIMATE_TARGET_RANGE_MAX}
        min={CLIMATE_TARGET_RANGE_MIN}
        step={CLIMATE_TARGET_RANGE_STEP}
        value={range}
        onPreview={(next) => {
          draggingRef.current = true;
          markInteraction();
          setRange(next);
        }}
        onCommit={(next) => void commit(next)}
      />
    </ConfigAccordion>
  );
}