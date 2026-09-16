import type { VoicePreferences } from "../types";
import { CUSTOM_SPEAKER_PATTERN, PRONOUN_MAX_LENGTH, PRONOUN_PATTERN, TRAINED_SPEAKER_PATTERN, VOICE_AFFECTATION_GROUPS, type VoiceAffectations } from "./constants";
import { AGENT_DISPLAY_NAME_STRIP, AGENT_NAME_MAX_LENGTH, AGENT_NAME_PRONUNCIATION_PATTERN, PERSONALITY_MAX_LENGTH, TRANSCRIPT_TEMPLATE_MAX_LENGTH, VOICE_SETTINGS_DEFAULTS, VOICE_SETTINGS_RANGES, WAKE_PREFIXES_PATTERN, WAKE_WORDS_MAX, WAKE_WORD_PATTERN, type VoiceSettings } from "./defaults";
import { ACCENTS, EMOTIONS, LANGUAGES, SPEAKERS, WEB_BACKEND_SET, cleanCompanionRoutes, cleanSatelliteIds, recordValue, storedChoice, storedNumber, type CompanionRouteChoice } from "./fields-model";
import type { VoicePronouns } from "./types";

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

// Custom-voice ids come from the voice server's registry rather than a fixed
// catalog, so the guard is the id shape, not a membership check.
function storedCustomSpeaker(value: unknown): string {
  if (typeof value !== "string") {
    return VOICE_SETTINGS_DEFAULTS.customSpeaker;
  }
  const candidate = value.trim().toLowerCase();
  return CUSTOM_SPEAKER_PATTERN.test(candidate) ? candidate : VOICE_SETTINGS_DEFAULTS.customSpeaker;
}

// Same shape as storedCustomSpeaker, but a stray value falls back to "" (no
// selection) rather than a made-up default id — there may be no trained voice
// yet.
function storedTrainedSpeaker(value: unknown): string {
  if (typeof value !== "string") {
    return VOICE_SETTINGS_DEFAULTS.trainedSpeaker;
  }
  const candidate = value.trim().toLowerCase();
  return TRAINED_SPEAKER_PATTERN.test(candidate) ? candidate : VOICE_SETTINGS_DEFAULTS.trainedSpeaker;
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

function storedDisabledSatellites(value: unknown): string[] {
  return Array.isArray(value)
    ? cleanSatelliteIds(value)
    : [...VOICE_SETTINGS_DEFAULTS.disabledSatellites];
}

// Unrecognised passes and choices are dropped rather than rejected: a stale
// preferences blob naming a pass this build no longer routes must not break the
// whole voice settings read, and the pass simply keeps the server's default.
function storedCompanionRoutes(value: unknown): Record<string, CompanionRouteChoice> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return cleanCompanionRoutes(value as Record<string, unknown>);
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
    // Only an explicit false turns training off, so a partial or legacy
    // preferences blob can never silently stop listening to the household.
    voiceTrainingEnabled: source.voiceTrainingEnabled !== false,
    disabledSatellites: storedDisabledSatellites(source.disabledSatellites),
    companionRoutes: storedCompanionRoutes(source.companionRoutes),
    // Carried through only when actually present. Anything else — missing, a
    // string, a legacy blob — leaves the voice server's own setting alone
    // rather than asserting a dashboard opinion nobody expressed.
    ...(typeof source.companionEnabled === "boolean"
      ? { companionEnabled: source.companionEnabled }
      : {}),
    ...(typeof source.companionForceLocal === "boolean"
      ? { companionForceLocal: source.companionForceLocal }
      : {}),
    // Only an explicit false bypasses the gate; legacy settings stay on the
    // bandwidth-saving and privacy-preserving default.
    satelliteNoiseGateEnabled: source.satelliteNoiseGateEnabled !== false,
    speaker: storedChoice(source.speaker, SPEAKERS, VOICE_SETTINGS_DEFAULTS.speaker),
    customSpeaker: storedCustomSpeaker(source.customSpeaker),
    trainedSpeaker: storedTrainedSpeaker(source.trainedSpeaker),
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
    conversationMaxSeconds: storedNumber(
      source.conversationMaxSeconds,
      VOICE_SETTINGS_DEFAULTS.conversationMaxSeconds,
      VOICE_SETTINGS_RANGES.conversationMaxSeconds.min,
      VOICE_SETTINGS_RANGES.conversationMaxSeconds.max,
      VOICE_SETTINGS_RANGES.conversationMaxSeconds.step,
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
    dotsNumSteps: storedNumber(
      source.dotsNumSteps,
      VOICE_SETTINGS_DEFAULTS.dotsNumSteps,
      VOICE_SETTINGS_RANGES.dotsNumSteps.min,
      VOICE_SETTINGS_RANGES.dotsNumSteps.max,
      VOICE_SETTINGS_RANGES.dotsNumSteps.step,
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
