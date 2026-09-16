"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeVoiceSettings, type VoiceSettings } from "../../../../lib/voice-settings";
import type { VoicePreferences } from "../../../../lib/types";
import { useAgentName } from "../../AgentNameContext";
import { useSettingCooldown } from "../../useSettingCooldown";
import type { PipelineKey, PipelineSettingKey, SyncResult } from "./types";
import { isPipelineSliderKey } from "./voice-infrastructure-model";

// State and commit path for VoicePipelineSettings (see the comment there).
export function useVoicePipelineSettings(initialSettings?: VoicePreferences | null) {
  const { agentName } = useAgentName();
  const [settings, setSettings] = useState<VoiceSettings>(() => normalizeVoiceSettings(initialSettings));
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"ok" | "warning" | "error">("ok");
  const draggingRef = useRef(new Set<PipelineKey>());
  const requestVersionRef = useRef(0);
  // Same rubber-band guard as the Voice Agent card: hold off the poll while a
  // slider is in use and for a few seconds after release.
  const { isCoolingDown, markInteraction } = useSettingCooldown();

  // What the voice server is actually doing. The stored preference only covers
  // passes someone has chosen; the rest sit on the server's own defaults, and
  // showing a stored-but-absent value as "voice server" would be a guess the
  // dropdown presents as fact.
  const [effectiveRoutes, setEffectiveRoutes] = useState<Record<string, string>>({});
  // The voice server's live switch positions, for the same reason as the
  // routes: these two settings have no dashboard default, so a box with no
  // stored value must show what the server is actually doing rather than a
  // guess. Starting "off" avoids the worse of the two wrong first frames —
  // claiming a feature is on when it is not.
  const [effectiveSwitches, setEffectiveSwitches] = useState({
    enabled: false,
    forceLocal: false,
  });

  const loadEffectiveRoutes = useCallback(async () => {
    try {
      const response = await fetch("/api/voice/companion-status", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as {
        status?: {
          enabled?: boolean;
          forceLocal?: boolean;
          routes?: { pass: string; mode: string }[];
        } | null;
      };
      const status = data.status;
      if (!status) return;
      setEffectiveSwitches({
        enabled: status.enabled === true,
        forceLocal: status.forceLocal === true,
      });
      const byMode: Record<string, string> = {
        local: "local",
        companion_only: "companion",
        companion_preferred: "companion",
        both: "both",
      };
      setEffectiveRoutes(
        Object.fromEntries(
          (status.routes ?? [])
            .map((route) => [route.pass, byMode[route.mode]])
            // `companion_fallback` and `disabled` have no dropdown equivalent.
            // Dropped rather than mapped to a near-miss, so a route set outside
            // this UI is not misreported as something choosable here.
            .filter(([, choice]) => Boolean(choice)),
        ),
      );
    } catch {
      // A voice server that cannot be reached leaves the last known routes on
      // screen rather than snapping every dropdown to a default it invented.
    }
  }, []);

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
        setSettings(normalizeVoiceSettings(data.voice));
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load voice pipeline settings", error);
    }
  }, [isCoolingDown]);

  useEffect(() => {
    void load();
    void loadEffectiveRoutes();
    const id = window.setInterval(() => {
      void load();
      void loadEffectiveRoutes();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [load, loadEffectiveRoutes]);

  const commit = useCallback(async (
    key: PipelineSettingKey,
    value: number | boolean | string | Record<string, string>,
  ) => {
    markInteraction();
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    if (isPipelineSliderKey(key)) {
      draggingRef.current.delete(key);
    }
    setSettings((current) => ({ ...current, [key]: value }));
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
      if (requestVersion === requestVersionRef.current && data.voice && draggingRef.current.size === 0) {
        setSettings(normalizeVoiceSettings(data.voice));
      }
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      if (!data.voiceHost?.ok) {
        setMessage(`Saved on ${agentName}. ${data.voiceHost?.error ?? "The voice host did not confirm the refresh."}`);
        setMessageTone("warning");
      }
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      setMessage(error instanceof Error ? error.message : "Failed to update voice settings");
      setMessageTone("error");
    }
  }, [agentName, markInteraction]);

  return {
    agentName,
    settings,
    setSettings,
    message,
    messageTone,
    draggingRef,
    markInteraction,
    effectiveRoutes,
    effectiveSwitches,
    loadEffectiveRoutes,
    commit,
  };
}

export type VoicePipelineController = ReturnType<typeof useVoicePipelineSettings>;
