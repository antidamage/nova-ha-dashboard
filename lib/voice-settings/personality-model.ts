import type { VoicePreferences } from "../types";
import { VOICE_AFFECTATION_GROUPS } from "./constants";
import type { VoicePersonalitySet, VoiceSettings } from "./defaults";
import { normalizeVoiceSettings } from "./normalize-model";

// The personality-scoped subset of a normalized settings object. Used by the
// library to snapshot and diff a saved personality against the live settings.
export function voicePersonalitySubset(settings: VoiceSettings): VoicePersonalitySet {
  return {
    speaker: settings.speaker,
    customSpeaker: settings.customSpeaker,
    trainedSpeaker: settings.trainedSpeaker,
    language: settings.language,
    accent: settings.accent,
    emotion: settings.emotion,
    personality: settings.personality,
    speechRate: settings.speechRate,
    pitch: settings.pitch,
    emotionMirroring: settings.emotionMirroring,
    temperature: settings.temperature,
    longResponseProbability: settings.longResponseProbability,
    commandReplyMinWords: settings.commandReplyMinWords,
    commandReplyMaxWords: settings.commandReplyMaxWords,
    pronouns: { ...settings.pronouns },
    affectations: { ...settings.affectations },
  };
}

// Normalize an arbitrary value into a personality set by running it through the
// full settings normalizer (so every field is validated identically to the live
// settings) and keeping only the personality-scoped fields.
export function normalizeVoicePersonalitySet(value: unknown): VoicePersonalitySet {
  return voicePersonalitySubset(normalizeVoiceSettings(value as Partial<VoicePreferences>));
}

// A stable string signature of a personality set, for dirty-checking a loaded
// personality against the live settings without depending on key order.
export function voicePersonalitySignature(set: VoicePersonalitySet): string {
  return JSON.stringify([
    set.speaker,
    set.customSpeaker,
    set.trainedSpeaker,
    set.language,
    set.accent,
    set.emotion,
    set.personality,
    set.speechRate,
    set.pitch,
    set.emotionMirroring,
    set.temperature,
    set.longResponseProbability,
    set.commandReplyMinWords,
    set.commandReplyMaxWords,
    set.pronouns.subjective,
    set.pronouns.objective,
    set.pronouns.possessive,
    // Flags in catalog order so the signature is independent of key order.
    ...VOICE_AFFECTATION_GROUPS.flatMap((group) =>
      group.options.map((option) => set.affectations[option.value])),
  ]);
}
