import type { VoicePreferences } from "./types";

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

export type VoiceSettings = Required<
  Pick<
    VoicePreferences,
    | "agentName" | "speaker" | "language" | "accent" | "speechRate" | "pitch" | "emotion"
    | "emotionMirroring" | "temperature" | "wakeWords" | "wakePrefixes"
    | "volumeDay" | "volumeNight" | "personality" | "conversationIdleSeconds"
    | "ttsPrerollMs" | "ttsFrameMs"
  >
> & { updatedAt?: string };

export type VoiceSettingsUpdate = Partial<Omit<VoiceSettings, "updatedAt">>;

export const AGENT_NAME_MAX_LENGTH = 40;
export const AGENT_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .'-]{0,39}$/u;
export const WAKE_WORD_PATTERN = /^[A-Za-z]{2,24}$/;
export const WAKE_WORDS_MAX = 12;
export const WAKE_PREFIXES_PATTERN = /^[A-Za-z ]{0,200}$/;
export const PERSONALITY_MAX_LENGTH = 2000;

export const VOICE_SETTINGS_DEFAULTS: VoiceSettings = {
  agentName: "Nova",
  speaker: "Ryan",
  language: "English",
  accent: "new-zealand",
  speechRate: 100,
  pitch: 0,
  emotion: "natural",
  emotionMirroring: 100,
  temperature: 0,
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
};

export const VOICE_SETTINGS_RANGES = {
  speechRate: { min: 70, max: 130, step: 5 },
  pitch: { min: -20, max: 20, step: 2 },
  emotionMirroring: { min: 0, max: 200, step: 10 },
  temperature: { min: 0, max: 5, step: 0.1 },
  volumeDay: { min: 0, max: 100, step: 5 },
  volumeNight: { min: 0, max: 100, step: 5 },
  conversationIdleSeconds: { min: 10, max: 300, step: 5 },
  ttsPrerollMs: { min: 200, max: 2000, step: 50 },
  ttsFrameMs: { min: 20, max: 200, step: 10 },
} as const;

const SPEAKERS = new Set<string>(VOICE_SPEAKERS.map(({ value }) => value));
const LANGUAGES = new Set<string>(VOICE_LANGUAGES.map(({ value }) => value));
const ACCENTS = new Set<string>(VOICE_ACCENTS.map(({ value }) => value));
const EMOTIONS = new Set<string>(VOICE_EMOTIONS.map(({ value }) => value));

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

function storedAgentName(value: unknown) {
  if (typeof value !== "string") {
    return VOICE_SETTINGS_DEFAULTS.agentName;
  }
  const candidate = value.trim().slice(0, AGENT_NAME_MAX_LENGTH);
  return AGENT_NAME_PATTERN.test(candidate) ? candidate : VOICE_SETTINGS_DEFAULTS.agentName;
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
    ...(typeof source.updatedAt === "string" ? { updatedAt: source.updatedAt } : {}),
  };
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

function updateAgentName(source: Record<string, unknown>): string | undefined {
  if (!("agentName" in source)) {
    return undefined;
  }
  const value = source.agentName;
  if (typeof value !== "string" || !AGENT_NAME_PATTERN.test(value.trim())) {
    throw new Error(`Agent name must be 1 to ${AGENT_NAME_MAX_LENGTH} characters`);
  }
  return value.trim();
}

export function parseVoiceSettingsUpdate(value: unknown): VoiceSettingsUpdate {
  const source = recordValue(value);
  const update: VoiceSettingsUpdate = {
    agentName: updateAgentName(source),
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
  };
  const provided = Object.fromEntries(
    Object.entries(update).filter(([, setting]) => setting !== undefined),
  ) as VoiceSettingsUpdate;
  if (Object.keys(provided).length === 0) {
    throw new Error("No voice settings provided");
  }
  return provided;
}
