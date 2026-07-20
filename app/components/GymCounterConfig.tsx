"use client";

import { Dumbbell } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  GYM_ALERT_THRESHOLD_DEFAULT_HOURS,
  GYM_ALERT_THRESHOLD_MAX_HOURS,
  GYM_ALERT_THRESHOLD_MIN_HOURS,
  normalizeGymAlertThresholdHours,
} from "../../lib/watchface-preferences";
import { ConfigAccordion, SliderControlPanel } from "./ConfigControls";
import { useSettingCooldown } from "./useSettingCooldown";

type GymCounterSettings = {
  gymAlertThresholdHours?: number;
};

function thresholdFromSettings(value: unknown) {
  return normalizeGymAlertThresholdHours(value ?? GYM_ALERT_THRESHOLD_DEFAULT_HOURS);
}

export function GymCounterConfig({ initialSettings }: { initialSettings?: GymCounterSettings | null }) {
  const [thresholdHours, setThresholdHours] = useState(() => thresholdFromSettings(initialSettings?.gymAlertThresholdHours));
  // Don't let the 30s poll overwrite the slider while (or just after) it's used.
  const { isCoolingDown, markInteraction } = useSettingCooldown();

  const load = useCallback(async () => {
    if (isCoolingDown()) {
      return;
    }
    try {
      const response = await fetch("/api/watchface", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Gym counter settings request failed: ${response.status}`);
      }
      const data = await response.json() as { watchface?: GymCounterSettings };
      if (!isCoolingDown()) {
        setThresholdHours(thresholdFromSettings(data.watchface?.gymAlertThresholdHours));
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load gym counter settings", error);
    }
  }, [isCoolingDown]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 30000);
    return () => window.clearInterval(id);
  }, [load]);

  const commitThresholdHours = useCallback(async (hours: number) => {
    markInteraction();
    const normalized = normalizeGymAlertThresholdHours(hours);
    setThresholdHours(normalized);
    try {
      const response = await fetch("/api/watchface", {
        body: JSON.stringify({ gymAlertThresholdHours: normalized }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Gym counter settings update failed: ${response.status}`);
      }
      const data = await response.json() as { watchface?: GymCounterSettings };
      if (data.watchface) {
        setThresholdHours(thresholdFromSettings(data.watchface.gymAlertThresholdHours));
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to update gym counter settings", error);
    }
  }, [markInteraction]);

  return (
    <ConfigAccordion title="Status Orb Info" icon={<Dumbbell className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />

      <div className="grid gap-4">
        <SliderControlPanel
          ariaLabel="Gym alert threshold"
          ariaValueText={`${thresholdHours} hours`}
          color={[60, 220, 240]}
          intensity={100}
          label="Alert Hours"
          max={GYM_ALERT_THRESHOLD_MAX_HOURS}
          min={GYM_ALERT_THRESHOLD_MIN_HOURS}
          step={1}
          value={thresholdHours}
          valueText={`${thresholdHours}h`}
          onPreview={(value) => {
            markInteraction();
            setThresholdHours(value);
          }}
          onCommit={commitThresholdHours}
        />
      </div>
    </ConfigAccordion>
  );
}
