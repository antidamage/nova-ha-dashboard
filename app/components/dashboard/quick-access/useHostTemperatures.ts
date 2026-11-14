"use client";

import { useEffect, useState } from "react";
import type { HostTemperaturesResponse } from "../../../../lib/host-temperatures/sources";

/** specs/host-temperature-gauges.md: poll every 5 s while visible; stale after 15 s. */
export const HOST_TEMPS_POLL_MS = 5000;
export const HOST_TEMPS_STALE_MS = 15000;

export type HostTemperaturesState = { data: HostTemperaturesResponse | null; receivedAt: number | null };

export function useHostTemperatures(enabled: boolean): HostTemperaturesState & { now: number } {
  const [state, setState] = useState<HostTemperaturesState>({ data: null, receivedAt: null });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let inFlight = false;
    const load = async () => {
      setNow(Date.now());
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const response = await fetch("/api/host-temperatures", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as HostTemperaturesResponse;
        if (!stopped && Array.isArray(data?.sources)) setState({ data, receivedAt: Date.now() });
      } catch {
        // Keep the last reading; it dims once it is older than HOST_TEMPS_STALE_MS.
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = window.setInterval(load, HOST_TEMPS_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  return { ...state, now };
}
