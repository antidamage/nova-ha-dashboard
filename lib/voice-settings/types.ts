// What voice controls to render for an engine. Mirrors the server's
// EngineCapabilities (nova_voice.tts_engines) so the UI renders off
// capability flags instead of `engine === "custom"` branches — this is the
// fallback used before the server's live per-engine capabilities load.
export type VoiceEngineCapabilities = {
  usesPresetSpeaker: boolean;
  usesAccentMood: boolean;
  usesCustomVoiceDropdown: boolean;
  usesNumSteps: boolean;
  voiceCatalogue: "none" | "clips" | "bundle";
};

// A live engine entry as published by the server's engine registry
// (dashboard_engines_manifest(): id/label/capabilities) — the client-safe
// shape both the Voice Agent picker and the Voice Infrastructure catalogue
// read from `/api/voice/*`'s `engines` field. Mirrors VoiceHostEngineDescriptor
// in lib/voice-host-settings.ts (that file is Node-only; this lets client
// components use the same shape without importing it).
export type VoiceEngineDescriptor = {
  id: string;
  label: string;
  capabilities?: VoiceEngineCapabilities;
};

// The agent's third-person pronouns, in the three forms the language model is
// told to use for itself. Each form is stored (and labelled) by its grammatical
// role so neo-pronoun sets — where the model can't infer one form from another —
// are represented exactly rather than guessed.
export type VoicePronouns = {
  /** Used as the sentence subject, e.g. "she" / "they" / "xe". */
  subjective: string;
  /** Used as the object of a verb or preposition, e.g. "her" / "them" / "xem". */
  objective: string;
  /** The independent possessive, e.g. "hers" / "theirs" / "xyrs". */
  possessive: string;
};
