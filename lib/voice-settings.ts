import type { VoicePreferences } from "./types";
import { DEFAULT_TRANSCRIPT_TEMPLATE } from "./voice-transcript";

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

export type VoiceSpeaker = (typeof VOICE_SPEAKERS)[number]["value"];
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number]["value"];
export type VoiceAccent = (typeof VOICE_ACCENTS)[number]["value"];
export type VoiceEmotion = (typeof VOICE_EMOTIONS)[number]["value"];
export type WebBackend = (typeof WEB_BACKENDS)[number]["value"];

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
const PRONOUN_FORMS = ["subjective", "objective", "possessive"] as const;

export type VoiceSettings = Required<
  Pick<
    VoicePreferences,
    | "agentName" | "agentNamePronunciation" | "systemVoiceEnabled" | "speakerRecognitionEnabled" | "disabledSatellites"
    | "satelliteNoiseGateEnabled"
    | "speaker" | "language" | "accent" | "speechRate"
    | "pitch" | "emotion" | "emotionMirroring" | "temperature" | "longResponseProbability"
    | "commandReplyMinWords" | "commandReplyMaxWords"
    | "webAccessEnabled" | "webBackend" | "webAnswerMaxSentences"
    | "wakeWords" | "wakePrefixes" | "volumeDay" | "volumeNight" | "personality"
    | "conversationIdleSeconds" | "ttsPrerollMs" | "ttsFrameMs" | "transcriptTemplate"
    | "speakerMatchThreshold" | "speakerMatchMargin" | "speakerClusterThreshold"
    | "speakerConversationMatchThreshold"
  >
  // `pronouns` and `affectations` are picked out of the loose `VoicePreferences`
  // shape and restated with the strict types the settings always normalize to.
> & { pronouns: VoicePronouns; affectations: VoiceAffectations; updatedAt?: string };

export type VoiceSettingsUpdate = Partial<Omit<VoiceSettings, "updatedAt">>;

// The subset of voice settings that make up a saved "personality": the agent's
// speaking character and language-model shaping, but not global plumbing (wake
// words, prefixes, volume, conversation window, preroll/frame, transcript
// decoration) or the agent's own name. A personality library entry stores
// exactly these fields; loading one writes them back into the live settings.
export const VOICE_PERSONALITY_FIELDS = [
  "speaker",
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
const AGENT_DISPLAY_NAME_STRIP = /[\u0000-\u001F\u007F-\u009F]/gu;
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
  // Indium is the primary microphone. Keep Nocturnium connected but muted by
  // default so a fresh/reset config never processes both co-located mics.
  disabledSatellites: ["nocturnium"],
  satelliteNoiseGateEnabled: true,
  speaker: "Ryan",
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
  // Recommended starting point for the fast-start streaming pipeline: a
  // 700ms preroll was tuned for the old ~2s first codec chunk. Sliders can
  // be moved back up from here if pacing deficits show up in /health.
  ttsPrerollMs: 400,
  ttsFrameMs: 100,
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
  ttsPrerollMs: { min: 20, max: 2000, step: 10 },
  ttsFrameMs: { min: 20, max: 200, step: 10 },
  // Cosine-similarity thresholds (0-1). Ranges are the sensible operating band
  // plus a little extra headroom at each end. `default` is fixed to the stock
  // value so the UI can mark it and snap to it.
  speakerMatchThreshold: { min: 0.3, max: 0.95, step: 0.01, default: 0.65 },
  speakerMatchMargin: { min: 0, max: 0.3, step: 0.01, default: 0.03 },
  speakerClusterThreshold: { min: 0.3, max: 0.95, step: 0.01, default: 0.6 },
  speakerConversationMatchThreshold: { min: 0.1, max: 0.9, step: 0.01, default: 0.35 },
} as const;

const SPEAKERS = new Set<string>(VOICE_SPEAKERS.map(({ value }) => value));
const LANGUAGES = new Set<string>(VOICE_LANGUAGES.map(({ value }) => value));
const ACCENTS = new Set<string>(VOICE_ACCENTS.map(({ value }) => value));
const EMOTIONS = new Set<string>(VOICE_EMOTIONS.map(({ value }) => value));
const WEB_BACKEND_SET = new Set<string>(WEB_BACKENDS.map(({ value }) => value));

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function storedChoice<T extends string>(value: unknown, choices: Set<string>, fallback: T): T {
  return typeof value === "string" && choices.has(value) ? value as T : fallback;
}

function storedNumber(value: unknown, fallback: number, min: number, max: number, step: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  const stepped = Math.round(number / step) * step;
  // Fractional steps (e.g. temperature's 0.1) accumulate float error without
  // an explicit precision clamp.
  return Number(Math.max(min, Math.min(max, stepped)).toFixed(4));
}

// The display name accepts any printable content (emoji included); only control
// characters are stripped. An empty result falls back to the default so the
// dashboard always has something to brand with.
function storedAgentName(value: unknown) {
  if (typeof value !== "string") {
    return VOICE_SETTINGS_DEFAULTS.agentName;
  }
  const candidate = value.replace(AGENT_DISPLAY_NAME_STRIP, "").trim().slice(0, AGENT_NAME_MAX_LENGTH);
  return candidate || VOICE_SETTINGS_DEFAULTS.agentName;
}

// The pronunciation is optional plain text. A missing value normalizes to "";
// a present but non-plain value also collapses to "" (voice service falls back
// to the display name) rather than corrupting the spoken/ASR name.
function storedAgentNamePronunciation(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const candidate = value.trim().slice(0, AGENT_NAME_MAX_LENGTH);
  if (!candidate) {
    return "";
  }
  return AGENT_NAME_PRONUNCIATION_PATTERN.test(candidate) ? candidate : "";
}

function storedPronounForm(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const candidate = value.trim().toLowerCase().slice(0, PRONOUN_MAX_LENGTH);
  return PRONOUN_PATTERN.test(candidate) ? candidate : fallback;
}

function storedPronouns(value: unknown): VoicePronouns {
  const source = recordValue(value);
  const fallback = VOICE_SETTINGS_DEFAULTS.pronouns;
  return {
    subjective: storedPronounForm(source.subjective, fallback.subjective),
    objective: storedPronounForm(source.objective, fallback.objective),
    possessive: storedPronounForm(source.possessive, fallback.possessive),
  };
}

function storedAffectations(value: unknown): VoiceAffectations {
  const source = recordValue(value);
  const result = {} as VoiceAffectations;
  for (const group of VOICE_AFFECTATION_GROUPS) {
    for (const option of group.options) {
      result[option.value] = source[option.value] === true;
    }
  }
  return result;
}

// Satellite ids are casefolded and de-duplicated (order preserved) to match the
// voice server's roster keys.
function cleanSatelliteIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      seen.add(item.trim().toLowerCase());
    }
  }
  return [...seen];
}

function storedDisabledSatellites(value: unknown): string[] {
  return Array.isArray(value)
    ? cleanSatelliteIds(value)
    : [...VOICE_SETTINGS_DEFAULTS.disabledSatellites];
}

function updateDisabledSatellites(source: Record<string, unknown>): string[] | undefined {
  if (!("disabledSatellites" in source)) {
    return undefined;
  }
  if (!Array.isArray(source.disabledSatellites)) {
    throw new Error("disabledSatellites must be an array of satellite ids");
  }
  return cleanSatelliteIds(source.disabledSatellites);
}

function normalizedWakeWords(value: unknown, legacyValue: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof legacyValue === "string"
      ? legacyValue.toLowerCase() === "beemo"
        ? VOICE_SETTINGS_DEFAULTS.wakeWords
        : [legacyValue]
      : VOICE_SETTINGS_DEFAULTS.wakeWords;
  const words = Array.from(new Set(source
    .filter((word): word is string => typeof word === "string")
    .map((word) => word.trim().toLowerCase())
    .filter((word) => WAKE_WORD_PATTERN.test(word))))
    .slice(0, WAKE_WORDS_MAX);
  return words.length ? words : [...VOICE_SETTINGS_DEFAULTS.wakeWords];
}

export function normalizeVoiceSettings(value?: Partial<VoicePreferences> | null): VoiceSettings {
  const source = recordValue(value);
  return {
    agentName: storedAgentName(source.agentName),
    agentNamePronunciation: storedAgentNamePronunciation(source.agentNamePronunciation),
    // Only an explicit false disables voice; anything else (missing, non-bool)
    // keeps voice on, so a partial/legacy preferences blob never mutes the house.
    systemVoiceEnabled: source.systemVoiceEnabled !== false,
    speakerRecognitionEnabled: source.speakerRecognitionEnabled !== false,
    disabledSatellites: storedDisabledSatellites(source.disabledSatellites),
    // Only an explicit false bypasses the gate; legacy settings stay on the
    // bandwidth-saving and privacy-preserving default.
    satelliteNoiseGateEnabled: source.satelliteNoiseGateEnabled !== false,
    speaker: storedChoice(source.speaker, SPEAKERS, VOICE_SETTINGS_DEFAULTS.speaker),
    language: storedChoice(source.language, LANGUAGES, VOICE_SETTINGS_DEFAULTS.language),
    accent: storedChoice(source.accent, ACCENTS, VOICE_SETTINGS_DEFAULTS.accent),
    speechRate: storedNumber(
      source.speechRate,
      VOICE_SETTINGS_DEFAULTS.speechRate,
      VOICE_SETTINGS_RANGES.speechRate.min,
      VOICE_SETTINGS_RANGES.speechRate.max,
      VOICE_SETTINGS_RANGES.speechRate.step,
    ),
    pitch: storedNumber(
      source.pitch,
      VOICE_SETTINGS_DEFAULTS.pitch,
      VOICE_SETTINGS_RANGES.pitch.min,
      VOICE_SETTINGS_RANGES.pitch.max,
      VOICE_SETTINGS_RANGES.pitch.step,
    ),
    emotion: storedChoice(source.emotion, EMOTIONS, VOICE_SETTINGS_DEFAULTS.emotion),
    emotionMirroring: storedNumber(
      source.emotionMirroring,
      VOICE_SETTINGS_DEFAULTS.emotionMirroring,
      VOICE_SETTINGS_RANGES.emotionMirroring.min,
      VOICE_SETTINGS_RANGES.emotionMirroring.max,
      VOICE_SETTINGS_RANGES.emotionMirroring.step,
    ),
    temperature: storedNumber(
      source.temperature,
      VOICE_SETTINGS_DEFAULTS.temperature,
      VOICE_SETTINGS_RANGES.temperature.min,
      VOICE_SETTINGS_RANGES.temperature.max,
      VOICE_SETTINGS_RANGES.temperature.step,
    ),
    longResponseProbability: storedNumber(
      source.longResponseProbability,
      VOICE_SETTINGS_DEFAULTS.longResponseProbability,
      VOICE_SETTINGS_RANGES.longResponseProbability.min,
      VOICE_SETTINGS_RANGES.longResponseProbability.max,
      VOICE_SETTINGS_RANGES.longResponseProbability.step,
    ),
    commandReplyMinWords: storedNumber(
      source.commandReplyMinWords,
      VOICE_SETTINGS_DEFAULTS.commandReplyMinWords,
      VOICE_SETTINGS_RANGES.commandReplyMinWords.min,
      VOICE_SETTINGS_RANGES.commandReplyMinWords.max,
      VOICE_SETTINGS_RANGES.commandReplyMinWords.step,
    ),
    commandReplyMaxWords: storedNumber(
      source.commandReplyMaxWords,
      VOICE_SETTINGS_DEFAULTS.commandReplyMaxWords,
      VOICE_SETTINGS_RANGES.commandReplyMaxWords.min,
      VOICE_SETTINGS_RANGES.commandReplyMaxWords.max,
      VOICE_SETTINGS_RANGES.commandReplyMaxWords.step,
    ),
    // Only an explicit true enables web access; anything else keeps it off, so a
    // partial/legacy preferences blob never silently opens outbound web calls.
    webAccessEnabled: source.webAccessEnabled === true,
    webBackend: storedChoice(source.webBackend, WEB_BACKEND_SET, VOICE_SETTINGS_DEFAULTS.webBackend),
    webAnswerMaxSentences: storedNumber(
      source.webAnswerMaxSentences,
      VOICE_SETTINGS_DEFAULTS.webAnswerMaxSentences,
      VOICE_SETTINGS_RANGES.webAnswerMaxSentences.min,
      VOICE_SETTINGS_RANGES.webAnswerMaxSentences.max,
      VOICE_SETTINGS_RANGES.webAnswerMaxSentences.step,
    ),
    wakeWords: normalizedWakeWords(source.wakeWords, source.wakeWord),
    wakePrefixes:
      typeof source.wakePrefixes === "string"
      && WAKE_PREFIXES_PATTERN.test(source.wakePrefixes)
        ? source.wakePrefixes.toLowerCase().trim()
        : VOICE_SETTINGS_DEFAULTS.wakePrefixes,
    volumeDay: storedNumber(
      source.volumeDay,
      VOICE_SETTINGS_DEFAULTS.volumeDay,
      VOICE_SETTINGS_RANGES.volumeDay.min,
      VOICE_SETTINGS_RANGES.volumeDay.max,
      VOICE_SETTINGS_RANGES.volumeDay.step,
    ),
    volumeNight: storedNumber(
      source.volumeNight,
      VOICE_SETTINGS_DEFAULTS.volumeNight,
      VOICE_SETTINGS_RANGES.volumeNight.min,
      VOICE_SETTINGS_RANGES.volumeNight.max,
      VOICE_SETTINGS_RANGES.volumeNight.step,
    ),
    // An explicitly cleared personality ("") is respected; only a missing or
    // non-string value falls back to the default.
    personality:
      typeof source.personality === "string"
        ? source.personality.slice(0, PERSONALITY_MAX_LENGTH).trim()
        : VOICE_SETTINGS_DEFAULTS.personality,
    conversationIdleSeconds: storedNumber(
      source.conversationIdleSeconds,
      VOICE_SETTINGS_DEFAULTS.conversationIdleSeconds,
      VOICE_SETTINGS_RANGES.conversationIdleSeconds.min,
      VOICE_SETTINGS_RANGES.conversationIdleSeconds.max,
      VOICE_SETTINGS_RANGES.conversationIdleSeconds.step,
    ),
    ttsPrerollMs: storedNumber(
      source.ttsPrerollMs,
      VOICE_SETTINGS_DEFAULTS.ttsPrerollMs,
      VOICE_SETTINGS_RANGES.ttsPrerollMs.min,
      VOICE_SETTINGS_RANGES.ttsPrerollMs.max,
      VOICE_SETTINGS_RANGES.ttsPrerollMs.step,
    ),
    ttsFrameMs: storedNumber(
      source.ttsFrameMs,
      VOICE_SETTINGS_DEFAULTS.ttsFrameMs,
      VOICE_SETTINGS_RANGES.ttsFrameMs.min,
      VOICE_SETTINGS_RANGES.ttsFrameMs.max,
      VOICE_SETTINGS_RANGES.ttsFrameMs.step,
    ),
    speakerMatchThreshold: storedNumber(
      source.speakerMatchThreshold,
      VOICE_SETTINGS_DEFAULTS.speakerMatchThreshold,
      VOICE_SETTINGS_RANGES.speakerMatchThreshold.min,
      VOICE_SETTINGS_RANGES.speakerMatchThreshold.max,
      VOICE_SETTINGS_RANGES.speakerMatchThreshold.step,
    ),
    speakerMatchMargin: storedNumber(
      source.speakerMatchMargin,
      VOICE_SETTINGS_DEFAULTS.speakerMatchMargin,
      VOICE_SETTINGS_RANGES.speakerMatchMargin.min,
      VOICE_SETTINGS_RANGES.speakerMatchMargin.max,
      VOICE_SETTINGS_RANGES.speakerMatchMargin.step,
    ),
    speakerClusterThreshold: storedNumber(
      source.speakerClusterThreshold,
      VOICE_SETTINGS_DEFAULTS.speakerClusterThreshold,
      VOICE_SETTINGS_RANGES.speakerClusterThreshold.min,
      VOICE_SETTINGS_RANGES.speakerClusterThreshold.max,
      VOICE_SETTINGS_RANGES.speakerClusterThreshold.step,
    ),
    speakerConversationMatchThreshold: storedNumber(
      source.speakerConversationMatchThreshold,
      VOICE_SETTINGS_DEFAULTS.speakerConversationMatchThreshold,
      VOICE_SETTINGS_RANGES.speakerConversationMatchThreshold.min,
      VOICE_SETTINGS_RANGES.speakerConversationMatchThreshold.max,
      VOICE_SETTINGS_RANGES.speakerConversationMatchThreshold.step,
    ),
    // Unlike personality, a cleared ("") template means "back to stock": an
    // empty decoration would render invisible headers, so it falls back.
    transcriptTemplate:
      typeof source.transcriptTemplate === "string" && source.transcriptTemplate.trim()
        ? source.transcriptTemplate.slice(0, TRANSCRIPT_TEMPLATE_MAX_LENGTH)
        : VOICE_SETTINGS_DEFAULTS.transcriptTemplate,
    pronouns: storedPronouns(source.pronouns),
    affectations: storedAffectations(source.affectations),
    ...(typeof source.updatedAt === "string" ? { updatedAt: source.updatedAt } : {}),
  };
}

// The personality-scoped subset of a normalized settings object. Used by the
// library to snapshot and diff a saved personality against the live settings.
export function voicePersonalitySubset(settings: VoiceSettings): VoicePersonalitySet {
  return {
    speaker: settings.speaker,
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

function updateChoice<T extends string>(
  source: Record<string, unknown>,
  field: string,
  choices: Set<string>,
): T | undefined {
  if (!(field in source)) {
    return undefined;
  }
  const value = source[field];
  if (typeof value !== "string" || !choices.has(value)) {
    throw new Error(`Unsupported voice ${field}: ${String(value)}`);
  }
  return value as T;
}

function updateNumber(
  source: Record<string, unknown>,
  field: string,
  range: { min: number; max: number; step: number },
) {
  if (!(field in source)) {
    return undefined;
  }
  const value = Number(source[field]);
  if (!Number.isFinite(value)) {
    throw new Error(`Voice ${field} must be a number`);
  }
  return storedNumber(value, range.min, range.min, range.max, range.step);
}

function updateBoolean(
  source: Record<string, unknown>,
  field: string,
): boolean | undefined {
  if (!(field in source)) {
    return undefined;
  }
  const value = source[field];
  if (typeof value !== "boolean") {
    throw new Error(`Voice ${field} must be true or false`);
  }
  return value;
}

function updateText(
  source: Record<string, unknown>,
  field: string,
  maxLength: number,
): string | undefined {
  if (!(field in source)) {
    return undefined;
  }
  const value = source[field];
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`Voice ${field} must be text of at most ${maxLength} characters`);
  }
  return value.trim();
}

function updatePattern(
  source: Record<string, unknown>,
  field: string,
  pattern: RegExp,
): string | undefined {
  if (!(field in source)) {
    return undefined;
  }
  const value = source[field];
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`Unsupported voice ${field}: ${String(value)}`);
  }
  return value.toLowerCase().trim();
}

function updateWakeWords(source: Record<string, unknown>): string[] | undefined {
  if (!("wakeWords" in source)) {
    return undefined;
  }
  if (!Array.isArray(source.wakeWords) || source.wakeWords.length < 1 || source.wakeWords.length > WAKE_WORDS_MAX) {
    throw new Error(`Voice wakeWords must contain 1 to ${WAKE_WORDS_MAX} words`);
  }
  const words = source.wakeWords.map((word) => {
    if (typeof word !== "string" || !WAKE_WORD_PATTERN.test(word.trim())) {
      throw new Error(`Unsupported wake word: ${String(word)}`);
    }
    return word.trim().toLowerCase();
  });
  if (new Set(words).size !== words.length) {
    throw new Error("Voice wakeWords must not contain duplicates");
  }
  return words;
}

function updatePronouns(source: Record<string, unknown>): VoicePronouns | undefined {
  if (!("pronouns" in source)) {
    return undefined;
  }
  const value = source.pronouns;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Voice pronouns must be an object with subjective, objective, and possessive forms");
  }
  const record = value as Record<string, unknown>;
  const result = {} as VoicePronouns;
  for (const form of PRONOUN_FORMS) {
    const candidate = record[form];
    if (typeof candidate !== "string") {
      throw new Error(`Voice pronoun ${form} must be text`);
    }
    const normalized = candidate.trim().toLowerCase();
    if (!PRONOUN_PATTERN.test(normalized)) {
      throw new Error(
        `Voice pronoun ${form} must be 1 to ${PRONOUN_MAX_LENGTH} letters (apostrophes and hyphens allowed)`,
      );
    }
    result[form] = normalized;
  }
  return result;
}

function updateAffectations(source: Record<string, unknown>): VoiceAffectations | undefined {
  if (!("affectations" in source)) {
    return undefined;
  }
  const value = source.affectations;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Voice affectations must be an object of on/off flags");
  }
  const record = value as Record<string, unknown>;
  // A posted affectations object is the complete set: known flags not present
  // are turned off, unknown keys are ignored.
  const result = {} as VoiceAffectations;
  for (const group of VOICE_AFFECTATION_GROUPS) {
    for (const option of group.options) {
      const flag = record[option.value];
      if (flag !== undefined && typeof flag !== "boolean") {
        throw new Error(`Voice affectation ${option.value} must be true or false`);
      }
      result[option.value] = flag === true;
    }
  }
  return result;
}

function updateAgentName(source: Record<string, unknown>): string | undefined {
  if (!("agentName" in source)) {
    return undefined;
  }
  const value = source.agentName;
  // The display name allows emoji and symbols; only control characters are
  // stripped. It must still be non-empty and within the length cap.
  const candidate =
    typeof value === "string"
      ? value.replace(AGENT_DISPLAY_NAME_STRIP, "").trim()
      : "";
  if (!candidate || candidate.length > AGENT_NAME_MAX_LENGTH) {
    throw new Error(`Agent display name must be 1 to ${AGENT_NAME_MAX_LENGTH} characters`);
  }
  return candidate;
}

function updateAgentNamePronunciation(source: Record<string, unknown>): string | undefined {
  if (!("agentNamePronunciation" in source)) {
    return undefined;
  }
  const value = source.agentNamePronunciation;
  if (typeof value !== "string") {
    throw new Error("Agent name pronunciation must be text");
  }
  const candidate = value.trim();
  // "" clears the pronunciation (voice service falls back to the display name).
  if (!candidate) {
    return "";
  }
  if (!AGENT_NAME_PRONUNCIATION_PATTERN.test(candidate)) {
    throw new Error(
      `Agent name pronunciation must be 1 to ${AGENT_NAME_MAX_LENGTH} letters, numbers, spaces, apostrophes, periods, or hyphens`,
    );
  }
  return candidate;
}

export function parseVoiceSettingsUpdate(value: unknown): VoiceSettingsUpdate {
  const source = recordValue(value);
  const update: VoiceSettingsUpdate = {
    agentName: updateAgentName(source),
    agentNamePronunciation: updateAgentNamePronunciation(source),
    systemVoiceEnabled: updateBoolean(source, "systemVoiceEnabled"),
    speakerRecognitionEnabled: updateBoolean(source, "speakerRecognitionEnabled"),
    disabledSatellites: updateDisabledSatellites(source),
    satelliteNoiseGateEnabled: updateBoolean(source, "satelliteNoiseGateEnabled"),
    speaker: updateChoice(source, "speaker", SPEAKERS),
    language: updateChoice(source, "language", LANGUAGES),
    accent: updateChoice(source, "accent", ACCENTS),
    speechRate: updateNumber(source, "speechRate", VOICE_SETTINGS_RANGES.speechRate),
    pitch: updateNumber(source, "pitch", VOICE_SETTINGS_RANGES.pitch),
    emotion: updateChoice(source, "emotion", EMOTIONS),
    emotionMirroring: updateNumber(
      source,
      "emotionMirroring",
      VOICE_SETTINGS_RANGES.emotionMirroring,
    ),
    temperature: updateNumber(source, "temperature", VOICE_SETTINGS_RANGES.temperature),
    longResponseProbability: updateNumber(
      source,
      "longResponseProbability",
      VOICE_SETTINGS_RANGES.longResponseProbability,
    ),
    commandReplyMinWords: updateNumber(
      source,
      "commandReplyMinWords",
      VOICE_SETTINGS_RANGES.commandReplyMinWords,
    ),
    commandReplyMaxWords: updateNumber(
      source,
      "commandReplyMaxWords",
      VOICE_SETTINGS_RANGES.commandReplyMaxWords,
    ),
    webAccessEnabled: updateBoolean(source, "webAccessEnabled"),
    webBackend: updateChoice(source, "webBackend", WEB_BACKEND_SET),
    webAnswerMaxSentences: updateNumber(
      source,
      "webAnswerMaxSentences",
      VOICE_SETTINGS_RANGES.webAnswerMaxSentences,
    ),
    wakeWords: updateWakeWords(source),
    wakePrefixes: updatePattern(source, "wakePrefixes", WAKE_PREFIXES_PATTERN),
    volumeDay: updateNumber(source, "volumeDay", VOICE_SETTINGS_RANGES.volumeDay),
    volumeNight: updateNumber(source, "volumeNight", VOICE_SETTINGS_RANGES.volumeNight),
    personality: updateText(source, "personality", PERSONALITY_MAX_LENGTH),
    conversationIdleSeconds: updateNumber(
      source,
      "conversationIdleSeconds",
      VOICE_SETTINGS_RANGES.conversationIdleSeconds,
    ),
    ttsPrerollMs: updateNumber(source, "ttsPrerollMs", VOICE_SETTINGS_RANGES.ttsPrerollMs),
    ttsFrameMs: updateNumber(source, "ttsFrameMs", VOICE_SETTINGS_RANGES.ttsFrameMs),
    speakerMatchThreshold: updateNumber(
      source,
      "speakerMatchThreshold",
      VOICE_SETTINGS_RANGES.speakerMatchThreshold,
    ),
    speakerMatchMargin: updateNumber(
      source,
      "speakerMatchMargin",
      VOICE_SETTINGS_RANGES.speakerMatchMargin,
    ),
    speakerClusterThreshold: updateNumber(
      source,
      "speakerClusterThreshold",
      VOICE_SETTINGS_RANGES.speakerClusterThreshold,
    ),
    speakerConversationMatchThreshold: updateNumber(
      source,
      "speakerConversationMatchThreshold",
      VOICE_SETTINGS_RANGES.speakerConversationMatchThreshold,
    ),
    // "" is accepted here so a cleared input persists and normalizes back to
    // the stock decoration on the next read.
    transcriptTemplate: updateText(source, "transcriptTemplate", TRANSCRIPT_TEMPLATE_MAX_LENGTH),
    pronouns: updatePronouns(source),
    affectations: updateAffectations(source),
  };
  const provided = Object.fromEntries(
    Object.entries(update).filter(([, setting]) => setting !== undefined),
  ) as VoiceSettingsUpdate;
  if (Object.keys(provided).length === 0) {
    throw new Error("No voice settings provided");
  }
  return provided;
}
