"use client";
import { useCallback, useEffect, useState } from "react";
import type { OrbTimer } from "../../../lib/orb-timer-model";
import { subscribeToDashboardEvents } from "../sharedDashboardEvents";
export function useOrbTimer(enabled = true) {
  const [timer, setTimer] = useState<OrbTimer | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let revision = 0;
    const load = async () => {
      const start = revision;
      try {
        const response = await fetch("/api/orb-timer", { cache: "no-store" });
        if (response.ok) { const data = await response.json(); if (alive && revision === start) setTimer(data.timer); }
      } catch { /* SSE and the next poll recover. */ }
    };
    const unsubscribe = subscribeToDashboardEvents({ "orb-timer": (event) => {
      try { const data = JSON.parse(event.data); revision++; if (alive) setTimer(data.timer); } catch { /* ignore malformed frames */ }
    } });
    void load();
    const poll = setInterval(load, 5000);
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => { alive = false; clearInterval(poll); clearInterval(tick); unsubscribe(); };
  }, [enabled]);
  const command = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch("/api/orb-timer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error("Timer command failed");
    const data = await response.json();
    if ("timer" in data) setTimer(data.timer);
    return data;
  }, []);
  return { timer, now, command };
}
