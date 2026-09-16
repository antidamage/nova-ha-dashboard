import type { VoicePreferences } from "../types";
import { DEFAULT_TRANSCRIPT_TEMPLATE } from "../voice-transcript";
import { DOTS_NUM_STEPS_RANGE, type VoiceAffectations } from "./constants";
import type { VoicePronouns } from "./types";

export type VoiceSettings = Required<
  Pick<
    VoicePreferences,
    | "agentName" | "agentNamePronunciation" | "systemVoiceEnabled" | "speakerRecognitionEnabled"
    | "voiceTrainingEnabled" | "disabledSatellites"
    | "satelliteNoiseGateEnabled" | "companionRoutes"
    | "speaker" | "customSpeaker" | "trainedSpeaker" | "language" | "accent" | "speechRate"
    | "pitch" | "emotion" | "emotionMirroring" | "temperature" | "longResponseProbability"
    | "commandReplyMinWords" | "commandReplyMaxWords"
    | "webAccessEnabled" | "webBackend" | "webAnswerMaxSentences"
    | "wakeWords" | "wakePrefixes" | "volumeDay" | "volumeNight" | "personality"
    | "conversationIdleSeconds" | "conversationMaxSeconds"
    | "ttsPrerollMs" | "ttsFrameMs" | "dotsNumSteps" | "transcriptTemplate"
    | "speakerMatchThreshold" | "speakerMatchMargin" | "speakerClusterThreshold"
    | "speakerConversationMatchThreshold"
  >
  // `pronouns` and `affectations` are picked out of the loose `VoicePreferences`
  // shape and restated with the strict types the settings always normalize to.
> & { pronouns: VoicePronouns; affectations: VoiceAffectations; updatedAt?: string }
  // Deliberately *not* in the `Required` pick above. Every other setting has a
  // dashboard default, but these two must be able to say "no opinion": a
  // dashboard that shipped `companionEnabled: true` would switch the feature
  // on for any deployment that had turned it off in configuration, the first
  // time anyone saved an unrelated voice setting. Undefined means "leave the
  // voice server as it is".
  & { companionEnabled?: boolean; companionForceLocal?: boolean };

export type VoiceSettingsUpdate = Partial<Omit<VoiceSettings, "updatedAt">>;

// The subset of voice settings that make up a saved "personality": the agent's
// speaking character and language-model shaping, but not global plumbing (wake
// words, prefixes, volume, conversation window, preroll/frame, transcript
// decoration) or the agent's own name. A personality library entry stores
// exactly these fields; loading one writes them back into the live settings.
export const VOICE_PERSONALITY_FIELDS = [
  "speaker",
  "customSpeaker",
  "trainedSpeaker",
  "language",
  "accent",
  "emotion",
  "personality",
  "speechRate",
  "pitch",
  "emotionMirroring",
  "temperature",
  "longResponseProbability",
  "commandReplyMinWords",
  "commandReplyMaxWords",
  "pronouns",
  "affectations",
] as const;

export type VoicePersonalityField = (typeof VOICE_PERSONALITY_FIELDS)[number];
export type VoicePersonalitySet = Pick<VoiceSettings, VoicePersonalityField>;

export const AGENT_NAME_MAX_LENGTH = 40;
// The DISPLAY name is unrestricted so emoji and symbols can brand the dashboard.
// Only control characters are stripped; everything else (letters, numbers,
// emoji, punctuation) is allowed up to the length cap.
// eslint-disable-next-line no-control-regex
export const AGENT_DISPLAY_NAME_STRIP = /[\u0000-\u001F\u007F-\u009F]/gu;
// The PRONUNCIATION is the spoken/ASR-facing name the voice service uses, so it
// stays plain text (letters, numbers, spaces, and light punctuation). It may be
// empty, in which case the voice service falls back to the display name.
export const AGENT_NAME_PRONUNCIATION_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .'-]{0,39}$/u;
// Retained for the voice-service contract: kept as an export in case other
// callers still reference the old strict agent-name shape.
export const AGENT_NAME_PATTERN = AGENT_NAME_PRONUNCIATION_PATTERN;
export const WAKE_WORD_PATTERN = /^[A-Za-z]{2,24}$/;
export const WAKE_WORDS_MAX = 12;
export const WAKE_PREFIXES_PATTERN = /^[A-Za-z ]{0,200}$/;
export const PERSONALITY_MAX_LENGTH = 2000;
export const TRANSCRIPT_TEMPLATE_MAX_LENGTH = 200;

export const VOICE_SETTINGS_DEFAULTS: VoiceSettings = {
  agentName: "Nova",
  // Empty by default: the voice service falls back to the display name when no
  // explicit pronunciation is given.
  agentNamePronunciation: "",
  // Voice is on by default; the killswitch is opt-in.
  systemVoiceEnabled: true,
  speakerRecognitionEnabled: true,
  // On after installation so a fresh house can enrol its first voice; the
  // owner turns it off once recognition is settled.
  voiceTrainingEnabled: true,
  // Empty: which satellites a house wants muted depends on which ones it has
  // and where they sit. This named one installation's second microphone, so
  // every other deployment shipped with a satellite id it does not own muted.
  // A house with two co-located mics mutes one from the satellite list in the
  // UI; that choice is stored settings, not a product default.
  disabledSatellites: [],
  satelliteNoiseGateEnabled: true,
  // Empty means every pass keeps the voice server's own default. The
  // dashboard deliberately does not restate those defaults: they are the
  // voice server's to choose, and duplicating them here would let the two
  // disagree silently after a change on either side.
  companionRoutes: {},
  speaker: "Ryan",
  // Default clone id on the Custom (dots.tts) engine; the picker replaces it
  // with a registered clone from the voice server's registry.
  customSpeaker: "johnny_multi",
  // No default trained voice until one has been trained; the picker fills
  // this in from the trained-voice registry once a voice exists.
  trainedSpeaker: "",
  language: "English",
  accent: "new-zealand",
  speechRate: 100,
  pitch: 0,
  emotion: "natural",
  emotionMirroring: 100,
  temperature: 0,
  longResponseProbability: 0,
  commandReplyMinWords: 0,
  commandReplyMaxWords: 3,
  // Web access is off by default; it is the only feature that sends any text
  // off the local network, so it is opt-in.
  webAccessEnabled: false,
  webBackend: "brave",
  webAnswerMaxSentences: 2,
  wakeWords: ["beemo", "bimo", "bemo", "beamo", "bmo"],
  wakePrefixes: "hey ok okay hi hello yo oi",
  volumeDay: 100,
  volumeNight: 100,
  personality: "You are a bright, bubbly helper!",
  conversationIdleSeconds: 60,
  conversationMaxSeconds: 300,
  // Recommended starting point for the fast-start streaming pipeline: a
  // 700ms preroll was tuned for the old ~2s first codec chunk. Sliders can
  // be moved back up from here if pacing deficits show up in /health.
  ttsPrerollMs: 400,
  ttsFrameMs: 100,
  dotsNumSteps: DOTS_NUM_STEPS_RANGE.default,
  // Speaker-matching thresholds — same values the voice service has always used
  // by default, so exposing the controls changes nothing until they are moved.
  speakerMatchThreshold: 0.65,
  speakerMatchMargin: 0.03,
  speakerClusterThreshold: 0.6,
  speakerConversationMatchThreshold: 0.35,
  transcriptTemplate: DEFAULT_TRANSCRIPT_TEMPLATE,
  // Neutral default so a fresh install refers to the agent with they/them
  // rather than assuming a gender.
  pronouns: { subjective: "they", objective: "them", possessive: "theirs" },
  // Every affectation defaults off: quirks are opt-in per personality.
  affectations: { pronounDrop: false },
};

export const VOICE_SETTINGS_RANGES = {
  speechRate: { min: 70, max: 130, step: 5 },
  pitch: { min: -20, max: 20, step: 2 },
  emotionMirroring: { min: 0, max: 200, step: 10 },
  temperature: { min: 0, max: 5, step: 0.1 },
  longResponseProbability: { min: 0, max: 1, step: 0.05 },
  commandReplyMinWords: { min: 0, max: 10, step: 1 },
  commandReplyMaxWords: { min: 0, max: 10, step: 1 },
  webAnswerMaxSentences: { min: 1, max: 5, step: 1, default: 2 },
  volumeDay: { min: 0, max: 100, step: 5 },
  volumeNight: { min: 0, max: 100, step: 5 },
  conversationIdleSeconds: { min: 10, max: 300, step: 5 },
  conversationMaxSeconds: { min: 60, max: 1800, step: 30, default: 300 },
  ttsPrerollMs: { min: 20, max: 2000, step: 10 },
  ttsFrameMs: { min: 20, max: 200, step: 10 },
  dotsNumSteps: DOTS_NUM_STEPS_RANGE,
  // Cosine-similarity thresholds (0-1). Ranges are the sensible operating band
  // plus a little extra headroom at each end. `default` is fixed to the stock
  // value so the UI can mark it and snap to it.
  speakerMatchThreshold: { min: 0.3, max: 0.95, step: 0.01, default: 0.65 },
  speakerMatchMargin: { min: 0, max: 0.3, step: 0.01, default: 0.03 },
  speakerClusterThreshold: { min: 0.3, max: 0.95, step: 0.01, default: 0.6 },
  speakerConversationMatchThreshold: { min: 0.1, max: 0.9, step: 0.01, default: 0.35 },
} as const;
