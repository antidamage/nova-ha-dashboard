"use client";

import { Thermometer } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  AIRCON_OFF_TIMER_INCREMENT_MINUTES_MAX,
  AIRCON_OFF_TIMER_INCREMENT_MINUTES_MIN,
  normalizeAirconOffTimerIncrementMinutes,
} from "../../lib/aircon-config";
import type { ConfigImportResult } from "../../lib/config-schema";
import { ConfigAccordion, SliderControlPanel } from "./ConfigControls";

type DashboardAirconConfig = {
  offTimerIncrementMinutes?: number;
};

type DashboardConfigResponse = {
  config?: unknown;
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function airconConfigFrom(value: unknown): DashboardAirconConfig {
  if (!isRecord(value)) {
    return {};
  }
  const dashboard = isRecord(value.dashboard) ? value.dashboard : {};
  return isRecord(dashboard.aircon) ? dashboard.aircon : {};
}

function configWithAirconIncrement(config: unknown, minutes: number) {
  const base = isRecord(config) ? config : {};
  const dashboard = isRecord(base.dashboard) ? base.dashboard : {};
  const aircon = isRecord(dashboard.aircon) ? dashboard.aircon : {};

  return {
    ...base,
    dashboard: {
      ...dashboard,
      aircon: {
        ...aircon,
        offTimerIncrementMinutes: minutes,
      },
    },
  };
}

export function DashboardClimateConfig({ initialSettings }: { initialSettings?: DashboardAirconConfig | null }) {
  const [config, setConfig] = useState<unknown>(null);
  const [timerIncrementMinutes, setTimerIncrementMinutes] = useState(() =>
    normalizeAirconOffTimerIncrementMinutes(initialSettings?.offTimerIncrementMinutes),
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      const payload = await response.json() as DashboardConfigResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Dashboard config request failed");
      }

      const nextConfig = payload.config ?? null;
      setConfig(nextConfig);
      setTimerIncrementMinutes(normalizeAirconOffTimerIncrementMinutes(airconConfigFrom(nextConfig).offTimerIncrementMinutes));
    } catch (error) {
      console.error("[nova-dashboard] failed to load climate config", error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const commitTimerIncrementMinutes = useCallback(async (minutes: number) => {
    const normalized = normalizeAirconOffTimerIncrementMinutes(minutes);
    setTimerIncrementMinutes(normalized);

    try {
      const nextConfig = configWithAirconIncrement(config, normalized);
      const response = await fetch("/api/config", {
        body: JSON.stringify({ config: nextConfig }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const payload = await response.json() as ConfigImportResult;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.ok === false ? payload.errors.map((error) => error.message).join("; ") : "Climate config update failed");
      }

      setConfig(payload.config);
      setTimerIncrementMinutes(normalizeAirconOffTimerIncrementMinutes(payload.config.dashboard.aircon.offTimerIncrementMinutes));
    } catch (error) {
      console.error("[nova-dashboard] failed to update climate config", error);
      void load();
    }
  }, [config, load]);

  return (
    <ConfigAccordion title="Climate Controls" icon={<Thermometer className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />

      <SliderControlPanel
        ariaLabel="Air conditioner off timer increment"
        ariaValueText={`${timerIncrementMinutes} minutes`}
        color={[60, 220, 240]}
        intensity={100}
        label="Timer Step"
        max={AIRCON_OFF_TIMER_INCREMENT_MINUTES_MAX}
        min={AIRCON_OFF_TIMER_INCREMENT_MINUTES_MIN}
        step={1}
        value={timerIncrementMinutes}
        valueText={`${timerIncrementMinutes}m`}
        onChange={setTimerIncrementMinutes}
        onCommit={commitTimerIncrementMinutes}
      />
    </ConfigAccordion>
  );
}
