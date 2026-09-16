"use client";

import { useEffect, useState } from "react";
import { VoiceTranscriptPanel } from "../VoiceTranscriptPanel";

/**
 * The Voice zone's whole-panel body: the killswitch reading (Voice
 * enabled/disabled, straight off the systemVoiceEnabled config checkbox) up
 * front, with the live transcript panel mounted directly underneath — no
 * Advanced fold wrapper around it.
 */
export function VoicePanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const response = await fetch("/api/voice", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { voice?: { systemVoiceEnabled?: boolean } };
        // Matches normalizeVoiceSettings: anything but an explicit false is on.
        if (alive) setEnabled(data.voice?.systemVoiceEnabled !== false);
      } catch (error) {
        // Keep the last known reading; a transient failure must not flip the label.
        console.error("[nova-dashboard] failed to read the voice setting", error);
      }
    };

    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="voice-panel border border-neutral-700 bg-neutral-950/70 p-5">
      <p
        className={
          "text-3xl font-black uppercase " +
          (enabled === null ? "text-neutral-500" : enabled ? "text-emerald-300" : "text-red-300")
        }
      >
        {enabled === null ? "Voice status..." : enabled ? "Voice enabled" : "Voice disabled"}
      </p>
      <VoiceTranscriptPanel />
    </div>
  );
}
