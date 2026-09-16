"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeVoiceSettings } from "../../../../lib/voice-settings";
import type { VoicePreferences } from "../../../../lib/types";
import { useAgentName } from "../../AgentNameContext";
import { SwitchRow } from "../../SlideSwitch";
import type { SyncResult } from "./types";

// System-wide voice killswitch. A single master on/off for the whole household:
// when off, voice host drops every microphone frame and closes the open
// conversation, so voice is fully disabled everywhere until it is turned back
// on. This is the shared, host-backed setting (POSTed to /api/voice, then pulled
// by VoiceHost) — distinct from the per-device browser voice-input toggle.
export function VoiceKillswitch({ initialSettings }: { initialSettings?: VoicePreferences | null }) {
  const { agentName } = useAgentName();
  const [enabled, setEnabled] = useState<boolean>(
    () => normalizeVoiceSettings(initialSettings).systemVoiceEnabled,
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"ok" | "warning" | "error">("ok");
  const requestVersionRef = useRef(0);

  const load = useCallback(async () => {
    // Never clobber an in-flight toggle with a stale poll.
    if (saving) {
      return;
    }
    try {
      const response = await fetch("/api/voice", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = await response.json() as { voice?: VoicePreferences };
      if (!saving) {
        setEnabled(normalizeVoiceSettings(data.voice).systemVoiceEnabled);
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load voice killswitch state", error);
    }
  }, [saving]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const toggle = useCallback(async () => {
    if (saving) {
      return;
    }
    const next = !enabled;
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setSaving(true);
    setEnabled(next);
    setMessage(
      next
        ? "Turning voice on and notifying the voice host…"
        : "Turning voice off and closing the current conversation…",
    );
    setMessageTone("ok");
    try {
      const response = await fetch("/api/voice", {
        body: JSON.stringify({ systemVoiceEnabled: next }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as {
        error?: string;
        voiceHost?: SyncResult;
        voice?: VoicePreferences;
      };
      if (!response.ok) {
        throw new Error(data.error || `Voice killswitch update failed: ${response.status}`);
      }
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      if (data.voice) {
        setEnabled(normalizeVoiceSettings(data.voice).systemVoiceEnabled);
      }
      if (data.voiceHost?.ok) {
        setMessage(
          next
            ? "Voice is ON — the whole system is listening again."
            : "Voice is OFF — every microphone is ignored system-wide and the conversation was closed.",
        );
        setMessageTone(next ? "ok" : "warning");
      } else {
        setMessage(`Saved on ${agentName}. ${data.voiceHost?.error ?? "The voice host did not confirm the change."}`);
        setMessageTone("warning");
      }
    } catch (error) {
      if (requestVersion === requestVersionRef.current) {
        // Revert the optimistic flip so the control matches reality.
        setEnabled(!next);
        setMessage(error instanceof Error ? error.message : "Failed to update the voice killswitch");
        setMessageTone("error");
      }
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setSaving(false);
      }
    }
  }, [agentName, enabled, saving]);

  return (
    <div className="mb-4 grid gap-2">
      <p className="text-xs font-black uppercase text-neutral-400">System voice</p>
      <SwitchRow
        checked={enabled}
        disabled={saving}
        label={enabled ? "Voice enabled" : "Voice OFF"}
        detail={
          enabled
            ? "Master switch for the whole system. Turn off to disable voice everywhere and close the current conversation."
            : "Voice is disabled for the entire system — no microphone is processed anywhere. Turn on to resume."
        }
        onChange={() => void toggle()}
      />
      {message ? (
        <p
          role="status"
          className={`text-sm font-semibold ${
            messageTone === "ok"
              ? "text-cyan-200"
              : messageTone === "warning"
                ? "text-yellow-200"
                : "text-red-200"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
