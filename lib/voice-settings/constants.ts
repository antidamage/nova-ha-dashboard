import type { VoiceEngineCapabilities, VoicePronouns } from "./types";

export const VOICE_SPEAKERS = [
  { value: "Ryan", label: "Ryan", detail: "Dynamic English voice with a strong rhythm" },
  { value: "Aiden", label: "Aiden", detail: "Sunny American voice with a clear midrange" },
  { value: "Vivian", label: "Vivian", detail: "Bright young Chinese voice" },
  { value: "Serena", label: "Serena", detail: "Warm, gentle young Chinese voice" },
  { value: "Uncle_Fu", label: "Uncle Fu", detail: "Seasoned, low and mellow Chinese voice" },
  { value: "Dylan", label: "Dylan", detail: "Youthful Beijing voice with a natural timbre" },
  { value: "Eric", label: "Eric", detail: "Lively Chengdu voice with a husky brightness" },
  { value: "Ono_Anna", label: "Ono Anna", detail: "Playful, light Japanese voice" },
  { value: "Sohee", label: "Sohee", detail: "Warm Korean voice with rich emotion" },
] as const;

export const VOICE_LANGUAGES = [
  { value: "Auto", label: "Automatic" },
  { value: "English", label: "English" },
  { value: "Chinese", label: "Chinese" },
  { value: "Japanese", label: "Japanese" },
  { value: "Korean", label: "Korean" },
  { value: "German", label: "German" },
  { value: "French", label: "French" },
  { value: "Russian", label: "Russian" },
  { value: "Portuguese", label: "Portuguese" },
  { value: "Spanish", label: "Spanish" },
  { value: "Italian", label: "Italian" },
] as const;

export const VOICE_ACCENTS = [
  { value: "voice-native", label: "Voice native" },
  { value: "new-zealand", label: "New Zealand" },
  { value: "australian", label: "Australian" },
  { value: "british", label: "British" },
  { value: "american", label: "American" },
  { value: "irish", label: "Irish" },
  { value: "scottish", label: "Scottish" },
] as const;

// Offered web-answer backends. Google (Gemini) is deliberately excluded by
// household policy; the voice service still supports a "gemini" backend in code
// for anyone with billing, but it is never offered here.
export const WEB_BACKENDS = [
  { value: "brave", label: "Brave Search (browser)", detail: "Scrapes Brave Search in a headless browser — Google-tier answers, keyless, non-Google. Best quality." },
  { value: "local", label: "DuckDuckGo (keyless)", detail: "Lightweight fallback — no browser, quicker to start, but rougher answers." },
] as const;

export const VOICE_EMOTIONS = [
  { value: "natural", label: "Natural" },
  { value: "calm", label: "Calm" },
  { value: "cheerful", label: "Cheerful" },
  { value: "empathetic", label: "Empathetic" },
  { value: "serious", label: "Serious" },
  { value: "dry", label: "Dry" },
  { value: "energetic", label: "Energetic" },
] as const;

// The TTS engine modules the voice server can host (one GPU-resident at a
// time). "classic" = Qwen3-TTS preset voices with accent/mood instructions;
// "custom" = dots.tts zero-shot cloned voices; "trained" = GPT-SoVITS voices
// fine-tuned from hundreds of samples. Which is active comes from the voice
// server; switching is an action (POST /api/voice/engine), not a stored
// preference. This static list is only the fallback shown before the server's
// own live engine list loads — see VoiceHostEngineStatus.engines in
// lib/voice-host-settings.ts, which carries the same ids with live
// capabilities from the server's engine registry.
export const VOICE_ENGINES = [
  { value: "classic", label: "Classic presets", detail: "Qwen3-TTS preset voices with accent and mood shaping." },
  { value: "custom", label: "Custom voices", detail: "dots.tts cloned voices built from your own reference clips." },
  { value: "trained", label: "Trained voices", detail: "GPT-SoVITS voices fine-tuned from hundreds of your own samples." },
] as const;

export type VoiceEngine = (typeof VOICE_ENGINES)[number]["value"];

// Each engine has its own disjoint voice namespace/settings field (see the
// customSpeaker/trainedSpeaker JSDoc on VoiceSettings above, and the
// server-side counterpart in nova_voice/tts_engines.py's resolve_speaker). A
// capability flag alone can't say WHICH field — this is the one place that
// maps engine id to field name, shared by the Voice Agent picker and the
// personality-library summary.
export const ENGINE_VOICE_FIELD: Record<VoiceEngine, "speaker" | "customSpeaker" | "trainedSpeaker"> = {
  classic: "speaker",
  custom: "customSpeaker",
  trained: "trainedSpeaker",
};

export const VOICE_ENGINE_CAPABILITIES: Record<VoiceEngine, VoiceEngineCapabilities> = {
  classic: {
    usesPresetSpeaker: true,
    usesAccentMood: true,
    usesCustomVoiceDropdown: false,
    usesNumSteps: false,
    voiceCatalogue: "none",
  },
  custom: {
    usesPresetSpeaker: false,
    usesAccentMood: false,
    usesCustomVoiceDropdown: true,
    usesNumSteps: true,
    voiceCatalogue: "clips",
  },
  trained: {
    usesPresetSpeaker: false,
    usesAccentMood: false,
    usesCustomVoiceDropdown: true,
    usesNumSteps: false,
    voiceCatalogue: "bundle",
  },
};

// Custom-voice ids are the dots registry's normalized form. Mirrors the voice
// server's validator so a value that persists here always resolves there.
export const CUSTOM_SPEAKER_PATTERN = /^[a-z0-9_-]{1,64}$/;

// Trained-voice ids are the trained-engine registry's normalized form — same
// shape as CUSTOM_SPEAKER_PATTERN, but empty is valid: until a voice has been
// trained there is no default to fall back to.
export const TRAINED_SPEAKER_PATTERN = /^[a-z0-9_-]{0,64}$/;

// Custom (dots.tts) diffusion step count — the model-side latency/quality lever.
// Fewer steps reach first audio sooner and cost less GPU per reply, at some
// quality cost; only affects the Custom engine.
export const DOTS_NUM_STEPS_RANGE = { min: 1, max: 16, step: 1, default: 6 } as const;

export type VoiceSpeaker = (typeof VOICE_SPEAKERS)[number]["value"];
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number]["value"];
export type VoiceAccent = (typeof VOICE_ACCENTS)[number]["value"];
export type VoiceEmotion = (typeof VOICE_EMOTIONS)[number]["value"];
export type WebBackend = (typeof WEB_BACKENDS)[number]["value"];

// Common presets offered in the picker. The stored value is always the three
// explicit forms; these are only conveniences for the UI.
export const VOICE_PRONOUN_PRESETS: { label: string; value: VoicePronouns }[] = [
  { label: "they/them/theirs", value: { subjective: "they", objective: "them", possessive: "theirs" } },
  { label: "she/her/hers", value: { subjective: "she", objective: "her", possessive: "hers" } },
  { label: "he/him/his", value: { subjective: "he", objective: "him", possessive: "his" } },
  { label: "xe/xem/xyrs", value: { subjective: "xe", objective: "xem", possessive: "xyrs" } },
  { label: "ze/zir/zirs", value: { subjective: "ze", objective: "zir", possessive: "zirs" } },
  { label: "it/it/its", value: { subjective: "it", objective: "it", possessive: "its" } },
];

// Speech affectations: deterministic quirks the voice service applies to the
// finished reply text (after the language model renders it), so they hold on
// every turn regardless of prompt drift. Grouped for the config UI's checkbox
// list; the option values are the stored settings keys.
export const VOICE_AFFECTATION_GROUPS = [
  {
    label: "Speech style",
    options: [
      {
        value: "pronounDrop",
        label: "Pronoun drop",
        detail: "Drops the first “I” or “we” in each sentence (“Am checking the weather.”).",
      },
    ],
  },
] as const;

export type VoiceAffectationKey =
  (typeof VOICE_AFFECTATION_GROUPS)[number]["options"][number]["value"];

export type VoiceAffectations = Record<VoiceAffectationKey, boolean>;

// Pronoun forms are short words. Neo-pronouns still need letters plus the
// apostrophe and hyphen that appear in real sets (e.g. "'em", "em's" style);
// everything is lower-cased for consistency.
export const PRONOUN_MAX_LENGTH = 20;
export const PRONOUN_PATTERN = /^[\p{L}][\p{L}'-]{0,19}$/u;
export const PRONOUN_FORMS = ["subjective", "objective", "possessive"] as const;
