"use client";

import { useCallback, useEffect } from "react";
import {
  normalizeVoiceSettings,
  type VoicePersonalitySet,
  type VoiceSettings,
} from "../../../../lib/voice-settings";
import type { VoicePreferences } from "../../../../lib/types";
import type { SyncResult } from "./types";
import type { VoiceAgentState } from "./useVoiceAgentState";

// Voice Agent settings poll and commit path. Runs after useVoiceAgentState;
// useVoiceAgentPersonality runs after this.
export function useVoiceAgentActions(state: VoiceAgentState) {
  const {
    setSettings,
    agentName,
    setAgentName,
    setTranscriptTemplate,
    setMessage,
    setMessageTone,
    draggingRef,
    requestVersionRef,
    isCoolingDown,
    markInteraction,
  } = state;

  const load = useCallback(async () => {
    if (draggingRef.current.size > 0 || isCoolingDown()) {
      return;
    }
    try {
      const response = await fetch("/api/voice", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Voice settings request failed: ${response.status}`);
      }
      const data = await response.json() as { voice?: VoicePreferences };
      if (draggingRef.current.size === 0 && !isCoolingDown()) {
        const next = normalizeVoiceSettings(data.voice);
        setSettings(next);
        setAgentName(next.agentName);
        setTranscriptTemplate(next.transcriptTemplate);
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load voice settings", error);
    }
  }, [isCoolingDown, setAgentName, setTranscriptTemplate]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const commit = useCallback(async <K extends keyof Omit<VoiceSettings, "updatedAt">>(
    key: K,
    value: VoiceSettings[K],
  ) => {
    markInteraction();
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    draggingRef.current.delete(key);
    setSettings((current) => ({ ...current, [key]: value }));
    const displayName = key === "agentName" && typeof value === "string" ? value : agentName;
    if (key === "agentName" && typeof value === "string") {
      setAgentName(value);
    }
    // No "saving"/"saved" banner: settings commit on every slider release, and a
    // status line appearing and disappearing under the controls shifts the page
    // out from under the gesture. Only problems are worth announcing.
    setMessage(null);
    try {
      const response = await fetch("/api/voice", {
        body: JSON.stringify({ [key]: value }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as {
        error?: string;
        voiceHost?: SyncResult;
        voice?: VoicePreferences;
      };
      if (!response.ok) {
        throw new Error(data.error || `Voice settings update failed: ${response.status}`);
      }
      if (
        requestVersion === requestVersionRef.current
        && data.voice
        && draggingRef.current.size === 0
      ) {
        const next = normalizeVoiceSettings(data.voice);
        setSettings(next);
        setAgentName(next.agentName);
        setTranscriptTemplate(next.transcriptTemplate);
      }
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      if (!data.voiceHost?.ok) {
        setMessage(`Saved on ${displayName}. ${data.voiceHost?.error ?? "The voice host did not confirm the refresh."}`);
        setMessageTone("warning");
      }
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      setMessage(error instanceof Error ? error.message : "Failed to update voice settings");
      setMessageTone("error");
    }
  }, [agentName, markInteraction, setAgentName, setTranscriptTemplate]);

  // Load a whole saved personality at once: one POST carries every
  // personality-scoped field (which then propagates to voice host like any other
  // voice-settings change), instead of firing a request per control.
  const commitMany = useCallback(async (set: VoicePersonalitySet) => {
    markInteraction();
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    for (const key of Object.keys(set) as (keyof VoicePersonalitySet)[]) {
      draggingRef.current.delete(key);
    }
    setSettings((current) => ({ ...current, ...set }));
    setMessage(`Applying personality on ${agentName} and notifying the voice host…`);
    setMessageTone("ok");
    try {
      const response = await fetch("/api/voice", {
        body: JSON.stringify(set),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as {
        error?: string;
        voiceHost?: SyncResult;
        voice?: VoicePreferences;
      };
      if (!response.ok) {
        throw new Error(data.error || `Voice settings update failed: ${response.status}`);
      }
      if (
        requestVersion === requestVersionRef.current
        && data.voice
        && draggingRef.current.size === 0
      ) {
        setSettings(normalizeVoiceSettings(data.voice));
      }
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      if (data.voiceHost?.ok) {
        setMessage(`Personality applied on ${agentName} and live on the voice host.`);
        setMessageTone("ok");
      } else {
        setMessage(`Personality applied on ${agentName}. ${data.voiceHost?.error ?? "The voice host did not confirm the refresh."}`);
        setMessageTone("warning");
      }
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      setMessage(error instanceof Error ? error.message : "Failed to apply personality");
      setMessageTone("error");
    }
  }, [agentName, markInteraction]);

  return {
    ...state,
    commit,
    commitMany,
  };
}

export type VoiceAgentActions = ReturnType<typeof useVoiceAgentActions>;
