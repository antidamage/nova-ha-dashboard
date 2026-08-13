"use client";

import { Activity } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  voiceServerOverall,
  voiceServerServiceRows,
  voiceServerWarmth,
  type VoiceServerStatusPayload,
} from "../../lib/voice-server-status";

const POLL_INTERVAL_MS = 5_000;

// "Is the voice server reachable right now?" readout for the config page. The
// dashboard server makes the actual mTLS /health round trip, so no browser
// ever needs the TLS identity; this component just polls the probe endpoint.
export function VoiceServerStatus() {
  const demoMode = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";
  const [payload, setPayload] = useState<VoiceServerStatusPayload | null>(null);
  const [probeFailed, setProbeFailed] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    // A probe slower than the poll interval must not stack requests behind
    // itself, and a hidden tab has no reader to poll for.
    if (demoMode || inFlight.current || document.hidden) {
      return;
    }
    inFlight.current = true;
    try {
      const response = await fetch("/api/voice/server-status", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`probe returned ${response.status}`);
      }
      setPayload(await response.json() as VoiceServerStatusPayload);
      setProbeFailed(false);
    } catch (error) {
      console.error("[nova-dashboard] voice server status probe failed", error);
      setProbeFailed(true);
    } finally {
      inFlight.current = false;
    }
  }, [demoMode]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (!document.hidden) {
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  if (demoMode) {
    return null;
  }

  const overall = voiceServerOverall(payload, probeFailed);
  const rows = payload?.reachable === true ? voiceServerServiceRows(payload.health) : [];
  // Sits with the service dots rather than in the headline alone: this is the
  // row someone checks when a reply took too long, and it is the only one that
  // can be amber — the others are up or down.
  const warmth = payload?.reachable === true ? voiceServerWarmth(payload.health) : null;
  const toneText =
    overall.tone === "ok" ? "text-cyan-200/80" : overall.tone === "warning" ? "text-yellow-200" : "text-red-200";

  return (
    <section
      aria-label="Voice server status"
      className="intensity-panel flex flex-wrap items-center justify-between gap-3 border border-cyan-300/30 bg-neutral-900/80 p-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Activity className="h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-sm font-black uppercase text-cyan-200">
            Voice Server{payload?.host ? ` · ${payload.host}` : ""}
          </p>
          <p role="status" className={`text-xs font-semibold ${toneText}`}>{overall.text}</p>
        </div>
      </div>
      {rows.length > 0 || warmth ? (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center gap-1.5 text-xs font-semibold text-neutral-300">
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${row.ok ? "bg-cyan-300" : "bg-red-400"}`}
              />
              {row.label}
            </li>
          ))}
          {warmth ? (
            <li className="flex items-center gap-1.5 text-xs font-semibold text-neutral-300">
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${
                  warmth.tone === "ok"
                    ? "bg-cyan-300"
                    : warmth.tone === "warning"
                      ? "bg-yellow-300"
                      : "bg-red-400"
                }`}
              />
              {warmth.text}
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
