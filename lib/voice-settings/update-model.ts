import { CUSTOM_SPEAKER_PATTERN, PRONOUN_FORMS, PRONOUN_MAX_LENGTH, PRONOUN_PATTERN, TRAINED_SPEAKER_PATTERN, VOICE_AFFECTATION_GROUPS, type VoiceAffectations } from "./constants";
import { AGENT_DISPLAY_NAME_STRIP, AGENT_NAME_MAX_LENGTH, AGENT_NAME_PRONUNCIATION_PATTERN, PERSONALITY_MAX_LENGTH, TRANSCRIPT_TEMPLATE_MAX_LENGTH, VOICE_SETTINGS_RANGES, WAKE_PREFIXES_PATTERN, WAKE_WORDS_MAX, WAKE_WORD_PATTERN, type VoiceSettingsUpdate } from "./defaults";
import { ACCENTS, EMOTIONS, LANGUAGES, SPEAKERS, WEB_BACKEND_SET, cleanCompanionRoutes, cleanSatelliteIds, recordValue, storedNumber, type CompanionRouteChoice } from "./fields-model";
import type { VoicePronouns } from "./types";

function updateDisabledSatellites(source: Record<string, unknown>): string[] | undefined {
  if (!("disabledSatellites" in source)) {
    return undefined;
  }
  if (!Array.isArray(source.disabledSatellites)) {
    throw new Error("disabledSatellites must be an array of satellite ids");
  }
  return cleanSatelliteIds(source.disabledSatellites);
}

function updateCompanionRoutes(
  source: Record<string, unknown>,
): Record<string, CompanionRouteChoice> | undefined {
  if (!("companionRoutes" in source)) {
    return undefined;
  }
  const value = source.companionRoutes;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("companionRoutes must be an object of pass ids to local/companion/both");
  }
  return cleanCompanionRoutes(value as Record<string, unknown>);
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
    voiceTrainingEnabled: updateBoolean(source, "voiceTrainingEnabled"),
    disabledSatellites: updateDisabledSatellites(source),
    companionRoutes: updateCompanionRoutes(source),
    companionEnabled: updateBoolean(source, "companionEnabled"),
    companionForceLocal: updateBoolean(source, "companionForceLocal"),
    satelliteNoiseGateEnabled: updateBoolean(source, "satelliteNoiseGateEnabled"),
    speaker: updateChoice(source, "speaker", SPEAKERS),
    customSpeaker: updatePattern(source, "customSpeaker", CUSTOM_SPEAKER_PATTERN),
    trainedSpeaker: updatePattern(source, "trainedSpeaker", TRAINED_SPEAKER_PATTERN),
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
    conversationMaxSeconds: updateNumber(
      source,
      "conversationMaxSeconds",
      VOICE_SETTINGS_RANGES.conversationMaxSeconds,
    ),
    ttsPrerollMs: updateNumber(source, "ttsPrerollMs", VOICE_SETTINGS_RANGES.ttsPrerollMs),
    ttsFrameMs: updateNumber(source, "ttsFrameMs", VOICE_SETTINGS_RANGES.ttsFrameMs),
    dotsNumSteps: updateNumber(source, "dotsNumSteps", VOICE_SETTINGS_RANGES.dotsNumSteps),
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
