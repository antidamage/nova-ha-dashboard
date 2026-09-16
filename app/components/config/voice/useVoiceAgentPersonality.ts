"use client";

import { useCallback, useMemo } from "react";
import {
  ENGINE_VOICE_FIELD,
  VOICE_ENGINE_CAPABILITIES,
  voicePersonalitySignature,
  voicePersonalitySubset,
} from "../../../../lib/voice-settings";
import { useVoicePersonalityLibrary } from "../../voicePersonalityLibrary";
import type { VoiceAgentActions } from "./useVoiceAgentActions";

// Voice Agent personality library, the audition, and the engine-capability
// gating the sections render from. Last of the three Voice Agent hooks.
export function useVoiceAgentPersonality(actions: VoiceAgentActions) {
  const {
    settings,
    agentName,
    setMessage,
    setMessageTone,
    voiceOptions,
    engine,
    engines,
    switchTarget,
    switchFailed,
    commitMany,
  } = actions;

  // ---- Personality library (save / load / rename / duplicate / delete) ------
  const personalityLibrary = useVoicePersonalityLibrary();
  const currentSubset = useMemo(() => voicePersonalitySubset(settings), [settings]);
  const activePersonality = useMemo(
    () =>
      personalityLibrary.library.entries.find(
        (entry) => entry.id === personalityLibrary.library.activeId,
      ) ?? null,
    [personalityLibrary.library],
  );
  const personalityDirty = useMemo(
    () =>
      activePersonality
        ? voicePersonalitySignature(currentSubset) !== voicePersonalitySignature(activePersonality.personality)
        : false,
    [activePersonality, currentSubset],
  );
  const loadPersonality = useCallback((id: string) => {
    const entry = personalityLibrary.library.entries.find((item) => item.id === id);
    if (!entry) {
      return;
    }
    void commitMany(entry.personality);
    personalityLibrary.setActive(id);
  }, [commitMany, personalityLibrary]);

  // Audition the whole configured voice: voice host asks the live language model a
  // random question (so temperature, personality, pronouns, and language all
  // show) and synthesizes the reply with the live voice, accent, mood, rate,
  // and pitch. Every knob is applied live, so this matches a real spoken turn.
  // The browser plays it locally — nothing is spoken through the satellites.
  const testPersonality = useCallback(async () => {
    if (switchTarget !== null && !switchFailed) {
      setMessage("An engine switch is in progress — voice preview returns once it completes.");
      setMessageTone("warning");
      return;
    }
    setMessage(`Asking ${agentName} to say something…`);
    setMessageTone("ok");
    try {
      const response = await fetch("/api/voice/preview", {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Voice preview failed: ${response.status}`);
      }
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      const cleanup = () => URL.revokeObjectURL(url);
      audio.addEventListener("ended", cleanup, { once: true });
      audio.addEventListener("error", cleanup, { once: true });
      await audio.play();
      setMessage(`Played ${agentName} speaking with the current settings.`);
      setMessageTone("ok");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to play a voice sample");
      setMessageTone("error");
    }
  }, [agentName, switchFailed, switchTarget]);

  // What controls to render for the active engine — from the server's live
  // engine list when available, else the static fallback map. Neither is a
  // hardcoded engine-id check, so a newly-registered engine renders correctly
  // without a dashboard code change (as long as it fits an existing
  // capability shape).
  const capabilities =
    engines.find((entry) => entry.id === engine)?.capabilities
    ?? VOICE_ENGINE_CAPABILITIES[engine];
  // The active engine decides which stored voice field the picker edits: each
  // engine has its own disjoint voice namespace (see VoiceSettings in
  // lib/voice-settings.ts) so it keeps its own last-used voice.
  const voiceField = ENGINE_VOICE_FIELD[engine];
  const activeVoiceValue = settings[voiceField];
  const selectedSpeaker = voiceOptions.find(({ value }) => value === activeVoiceValue);
  // A persisted voice id can predate the registry list (or the registry may be
  // briefly unreachable); keep it selectable rather than showing a mismatched
  // dropdown. Skip this for an empty value (e.g. no trained voice yet).
  const engineVoiceOptions =
    capabilities.usesCustomVoiceDropdown && !selectedSpeaker && activeVoiceValue
      ? [{ value: activeVoiceValue, label: activeVoiceValue }, ...voiceOptions]
      : voiceOptions;
  const switchInFlight = switchTarget !== null && !switchFailed;
  // Saved personalities are engine-scoped: the picker lists only profiles for
  // the engine currently loaded (plus legacy profiles saved before engines were
  // tracked, which have no tag yet and stay visible under any engine).
  const visiblePersonalities = personalityLibrary.library.entries.filter(
    (entry) => entry.engine == null || entry.engine === engine,
  );
  const activePersonalityVisible = visiblePersonalities.some(
    (entry) => entry.id === personalityLibrary.library.activeId,
  );

  return {
    ...actions,
    personalityLibrary,
    currentSubset,
    personalityDirty,
    loadPersonality,
    testPersonality,
    capabilities,
    voiceField,
    activeVoiceValue,
    selectedSpeaker,
    engineVoiceOptions,
    switchInFlight,
    visiblePersonalities,
    activePersonalityVisible,
  };
}

export type VoiceAgentController = ReturnType<typeof useVoiceAgentPersonality>;
