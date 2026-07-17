"use client";

import { Cpu } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ConfigAccordion, SliderControlPanel } from "./ConfigControls";

type WatchfaceSettings = {
  idleTimeoutMs?: number;
};

const DEFAULT_IDLE_MINUTES = 5;
const MIN_IDLE_MINUTES = 1;
const MAX_IDLE_MINUTES = 60;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function minutesFromMs(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_IDLE_MINUTES;
  }
  return clamp(Math.round(parsed / 60000), MIN_IDLE_MINUTES, MAX_IDLE_MINUTES);
}

export function WaveshareWatchfaceConfig({ initialSettings }: { initialSettings?: WatchfaceSettings | null }) {
  const [idleMinutes, setIdleMinutes] = useState(() => minutesFromMs(initialSettings?.idleTimeoutMs));

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/watchface", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Watchface settings request failed: ${response.status}`);
      }
      const data = await response.json() as { watchface?: WatchfaceSettings };
      const next = data.watchface ?? {};
      setIdleMinutes(minutesFromMs(next.idleTimeoutMs));
    } catch (error) {
      console.error("[nova-dashboard] failed to load watchface settings", error);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 30000);
    return () => window.clearInterval(id);
  }, [load]);

  const commitIdleMinutes = useCallback(async (minutes: number) => {
    const normalized = clamp(Math.round(minutes), MIN_IDLE_MINUTES, MAX_IDLE_MINUTES);
    setIdleMinutes(normalized);
    try {
      const response = await fetch("/api/watchface", {
        body: JSON.stringify({ idleTimeoutMs: normalized * 60000 }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Watchface settings update failed: ${response.status}`);
      }
      const data = await response.json() as { watchface?: WatchfaceSettings };
      if (data.watchface) {
        setIdleMinutes(minutesFromMs(data.watchface.idleTimeoutMs));
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to update watchface settings", error);
    }
  }, []);

  return (
    <ConfigAccordion title="Hardware Assistant" icon={<Cpu className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />

      <div className="grid gap-4">
        <SliderControlPanel
          ariaLabel="Watchface idle timeout"
          ariaValueText={`${idleMinutes} minutes`}
          color={[60, 220, 240]}
          intensity={100}
          label="Power Timer"
          max={MAX_IDLE_MINUTES}
          min={MIN_IDLE_MINUTES}
          step={1}
          value={idleMinutes}
          valueText={`${idleMinutes}m`}
          onChange={setIdleMinutes}
          onCommit={commitIdleMinutes}
        />
      </div>
    </ConfigAccordion>
  );
}
