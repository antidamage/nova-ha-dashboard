"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  VOICE_ENGINES,
  VOICE_SPEAKERS,
  normalizeVoiceSettings,
  type VoiceEngine,
  type VoiceEngineDescriptor,
  type VoiceSettings,
} from "../../../../lib/voice-settings";
import type { VoicePreferences } from "../../../../lib/types";
import { useAgentName } from "../../AgentNameContext";
import { useSettingCooldown } from "../../useSettingCooldown";
import type { VoiceOption } from "./types";

const VOICE_ENGINE_VALUES = new Set<string>(VOICE_ENGINES.map(({ value }) => value));
function isVoiceEngine(value: unknown): value is VoiceEngine {
  return typeof value === "string" && VOICE_ENGINE_VALUES.has(value);
}

// Voice Agent state and the engine switch. The settings commit path and the
// derived render values are in useVoiceAgentActions and useVoiceAgentPersonality.
export function useVoiceAgentState(initialSettings?: VoicePreferences | null) {
  const [settings, setSettings] = useState<VoiceSettings>(() => normalizeVoiceSettings(initialSettings));
  const { agentName, setAgentName, setTranscriptTemplate } = useAgentName();
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"ok" | "warning" | "error">("ok");
  const [voiceOptions, setVoiceOptions] = useState<readonly VoiceOption[]>(VOICE_SPEAKERS);
  const [optionsSource, setOptionsSource] = useState<"static" | "voiceHost" | "fallback">("static");
  // Active TTS engine module. Which voice controls render (preset dropdown vs
  // a cloned/trained-voice dropdown, accent/mood, diffusion steps) is decided
  // by this engine's capabilities below, not a hardcoded engine-id check.
  const [engine, setEngine] = useState<VoiceEngine>("classic");
  // The server's live engine list (id/label/capabilities), from the same
  // registry manifest the engine picker and switch machinery use. Falls back
  // to the static VOICE_ENGINE_CAPABILITIES map (no capabilities server data
  // yet) so the panel still renders sensibly before the first successful poll.
  const [engines, setEngines] = useState<readonly VoiceEngineDescriptor[]>([]);
  // Prefers the server's live label (matches the engine that's actually
  // deployed) over the static fallback, so display text never drifts from
  // reality even if VOICE_ENGINES's copy goes stale.
  const engineLabel = useCallback((id: string) =>
    engines.find((entry) => entry.id === id)?.label
    ?? VOICE_ENGINES.find((entry) => entry.value === id)?.label
    ?? id, [engines]);
  // Engine switcher state. `pendingEngine` is a radio selection awaiting the
  // explicit confirm (a switch restarts voice services, so it never fires from
  // a single click); `switchTarget` is a swap in flight, followed by polling
  // /api/voice/engine — the voice server restarts mid-swap, so unreachable
  // polls are an expected phase, not an error.
  const [pendingEngine, setPendingEngine] = useState<VoiceEngine | null>(null);
  const [switchTarget, setSwitchTarget] = useState<VoiceEngine | null>(null);
  const [switchNote, setSwitchNote] = useState<string | null>(null);
  const [switchFailed, setSwitchFailed] = useState(false);
  const draggingRef = useRef(new Set<keyof VoiceSettings>());
  const requestVersionRef = useRef(0);
  // After any control is used, hold off the 30s poll for a few seconds so an
  // in-flight refresh can't rubber-band the value back (draggingRef only covers
  // the active drag; this covers the window after release too).
  const { isCoolingDown, markInteraction } = useSettingCooldown();

  // voice host publishes the voices its deployed TTS stack actually supports;
  // populate the dropdown from it and keep the static list as the fallback.
  // Re-run after an engine switch: the voice list is per-engine (Classic
  // presets vs the Custom clone registry).
  const loadVoiceOptions = useCallback(async () => {
    try {
      const response = await fetch("/api/voice/options", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = await response.json() as {
        source?: string;
        voices?: VoiceOption[];
        engine?: string;
        engines?: VoiceEngineDescriptor[];
      };
      if (Array.isArray(data.voices) && data.voices.length > 0) {
        setVoiceOptions(data.voices);
        setOptionsSource(data.source === "voiceHost" ? "voiceHost" : "fallback");
      }
      if (Array.isArray(data.engines) && data.engines.length > 0) {
        setEngines(data.engines);
      }
      if (isVoiceEngine(data.engine)) {
        setEngine(data.engine);
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load voice options", error);
    }
  }, []);

  useEffect(() => {
    void loadVoiceOptions();
  }, [loadVoiceOptions]);

  // Ask the voice server to swap the resident TTS engine. Acceptance is not
  // completion: the server hands the swap to its root-side switcher and
  // restarts itself, so progress is followed by the polling effect below.
  const requestEngineSwitch = useCallback(async (target: VoiceEngine) => {
    setPendingEngine(null);
    setSwitchFailed(false);
    setSwitchTarget(target);
    setSwitchNote("Asking the voice server to switch engines…");
    try {
      const response = await fetch("/api/voice/engine", {
        body: JSON.stringify({ engine: target }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        changed?: boolean;
      };
      if (!response.ok) {
        throw new Error(data.error || `Engine switch failed: ${response.status}`);
      }
      if (data.changed === false) {
        setEngine(target);
        setSwitchTarget(null);
        setSwitchNote(null);
        return;
      }
      setSwitchNote("Switch accepted — voice services are restarting…");
    } catch (error) {
      setSwitchFailed(true);
      setSwitchNote(error instanceof Error ? error.message : "Engine switch request failed");
    }
  }, []);

  useEffect(() => {
    if (switchTarget === null || switchFailed) {
      return;
    }
    let cancelled = false;
    const id = window.setInterval(async () => {
      try {
        const response = await fetch("/api/voice/engine", { cache: "no-store" });
        if (!response.ok || cancelled) {
          return;
        }
        const data = await response.json() as {
          reachable?: boolean;
          engine?: string;
          switch?: { target?: string; phase?: string; error?: string };
        };
        if (cancelled) {
          return;
        }
        if (!data.reachable) {
          setSwitchNote("Voice services are restarting…");
          return;
        }
        const phase = data.switch?.phase;
        if (phase === "failed") {
          setSwitchFailed(true);
          setSwitchNote(`Engine switch failed: ${data.switch?.error ?? "see the voice server logs"}`);
          return;
        }
        if (data.engine === switchTarget && phase === "ready") {
          setSwitchTarget(null);
          setSwitchNote(null);
          setEngine(switchTarget);
          setMessage(
            `Switched to the ${engineLabel(switchTarget)} engine.`,
          );
          setMessageTone("ok");
          void loadVoiceOptions();
          return;
        }
        setSwitchNote(
          phase === "warming"
            // The ~7 minute figure is specifically measured for the Custom
            // (dots.tts) engine's optimize=True warmup; other engines' warmup
            // time isn't asserted here until it's been measured the same way.
            ? `New engine is loading and warming up${switchTarget === "custom" ? " — Custom takes around 7 minutes…" : "…"}`
            : "Voice services are restarting…",
        );
      } catch {
        // Expected while the voice server is down mid-switch; keep polling.
      }
    }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [switchFailed, switchTarget, loadVoiceOptions, engineLabel]);

  return {
    settings,
    setSettings,
    agentName,
    setAgentName,
    setTranscriptTemplate,
    message,
    setMessage,
    messageTone,
    setMessageTone,
    voiceOptions,
    optionsSource,
    engine,
    engines,
    engineLabel,
    pendingEngine,
    setPendingEngine,
    switchTarget,
    switchNote,
    switchFailed,
    draggingRef,
    requestVersionRef,
    isCoolingDown,
    markInteraction,
    loadVoiceOptions,
    requestEngineSwitch,
  };
}

export type VoiceAgentState = ReturnType<typeof useVoiceAgentState>;
