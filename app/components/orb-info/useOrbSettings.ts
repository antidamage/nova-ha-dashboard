"use client";
import { useEffect, useState } from "react";
import type { OrbInfoPreferences } from "../../../lib/orb-info/types";
import { resolveOrbEntries } from "../../../lib/orb-info/preferences";
import { normalizeTimerIcons } from "../../../lib/orb-timer-settings";
import { subscribeToDashboardEvents } from "../sharedDashboardEvents";
export function useOrbSettings() {
  const [settings, setSettings] = useState<OrbInfoPreferences>();
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const response = await fetch("/api/orb-info", { cache: "no-store" }); if (response.ok) { const data = await response.json(); if (alive) setSettings(data.orbInfo); } } catch { /* retry */ } };
    void load(); const poll = setInterval(load, 30000);
    const unsubscribe = subscribeToDashboardEvents({ state: (event) => { try { const data = JSON.parse(event.data); if (alive && data.preferences?.orbInfo) setSettings(data.preferences.orbInfo); } catch { /* ignore malformed frame */ } } });
    window.addEventListener("nova-orb-info-change", load);
    return () => { alive = false; clearInterval(poll); unsubscribe(); window.removeEventListener("nova-orb-info-change", load); };
  }, []);
  const entries = resolveOrbEntries(settings);
  return { entries, icons: normalizeTimerIcons(settings?.timerIcons), hasWashing: entries.some((entry) => entry.moduleId === "washing"), hasTimer: entries.some((entry) => entry.moduleId === "timer") };
}
