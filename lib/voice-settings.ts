/**
 * Voice settings — facade. The body lives in lib/voice-settings/; this file
 * keeps the import path stable for its callers
 * (specs/agent-token-footprint.md §3.3). Client-safe: nothing here touches
 * Node or state.
 *
 * Where things are:
 *
 *   voice-settings/types.ts                engine capabilities/descriptor, pronouns
 *   voice-settings/constants.ts            speaker/language/accent/emotion/engine
 *                                          catalogues, id patterns, pronoun
 *                                          presets, affectation groups
 *   voice-settings/defaults.ts             VoiceSettings shape, personality
 *                                          fields, name/wake limits, defaults,
 *                                          slider ranges
 *   voice-settings/fields-model.ts         shared coercion helpers, satellite
 *                                          ids, companion routable passes
 *   voice-settings/normalize-model.ts      normalizeVoiceSettings and its
 *                                          per-field readers
 *   voice-settings/personality-model.ts    personality subset/normalise/signature
 *   voice-settings/update-model.ts         parseVoiceSettingsUpdate and its
 *                                          per-field validators
 */
export type {
  VoiceEngineCapabilities,
  VoiceEngineDescriptor,
  VoicePronouns,
} from "./voice-settings/types";
export type {
  VoiceAccent,
  VoiceAffectationKey,
  VoiceAffectations,
  VoiceEmotion,
  VoiceEngine,
  VoiceLanguage,
  VoiceSpeaker,
  WebBackend,
} from "./voice-settings/constants";
export {
  CUSTOM_SPEAKER_PATTERN,
  DOTS_NUM_STEPS_RANGE,
  ENGINE_VOICE_FIELD,
  PRONOUN_MAX_LENGTH,
  PRONOUN_PATTERN,
  TRAINED_SPEAKER_PATTERN,
  VOICE_ACCENTS,
  VOICE_AFFECTATION_GROUPS,
  VOICE_EMOTIONS,
  VOICE_ENGINES,
  VOICE_ENGINE_CAPABILITIES,
  VOICE_LANGUAGES,
  VOICE_PRONOUN_PRESETS,
  VOICE_SPEAKERS,
  WEB_BACKENDS,
} from "./voice-settings/constants";
export type {
  VoicePersonalityField,
  VoicePersonalitySet,
  VoiceSettings,
  VoiceSettingsUpdate,
} from "./voice-settings/defaults";
export {
  AGENT_NAME_MAX_LENGTH,
  AGENT_NAME_PATTERN,
  AGENT_NAME_PRONUNCIATION_PATTERN,
  PERSONALITY_MAX_LENGTH,
  TRANSCRIPT_TEMPLATE_MAX_LENGTH,
  VOICE_PERSONALITY_FIELDS,
  VOICE_SETTINGS_DEFAULTS,
  VOICE_SETTINGS_RANGES,
  WAKE_PREFIXES_PATTERN,
  WAKE_WORDS_MAX,
  WAKE_WORD_PATTERN,
} from "./voice-settings/defaults";
export type { CompanionRoutablePass, CompanionRouteChoice } from "./voice-settings/fields-model";
export { COMPANION_ROUTABLE_PASSES } from "./voice-settings/fields-model";
export { normalizeVoiceSettings } from "./voice-settings/normalize-model";
export {
  normalizeVoicePersonalitySet,
  voicePersonalitySignature,
  voicePersonalitySubset,
} from "./voice-settings/personality-model";
export { parseVoiceSettingsUpdate } from "./voice-settings/update-model";
