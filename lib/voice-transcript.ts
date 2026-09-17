// Voice transcript parsing and formatting — facade. The body lives in
// lib/voice-transcript/; this file keeps the import path stable for its
// callers (specs/agent-token-footprint.md §3.3).
//
// Where things are:
//
//   voice-transcript/types.ts         VoiceTranscriptEvent, Route, LineParts, …
//   voice-transcript/constants.ts     limits, outcomes, glyphs, header template
//   voice-transcript/parse.ts         parseVoiceTranscriptInput/ReplaceInput
//   voice-transcript/format-model.ts  status/mode labels, header + line formatting

export type {
  VoiceTranscriptRole,
  VoiceTranscriptKind,
  VoiceTranscriptOutcome,
  VoiceTranscriptStatus,
  VoiceTranscriptEvent,
  VoiceTranscriptRoute,
  VoiceTranscriptReplaceInput,
  VoiceTranscriptLineParts,
} from "./voice-transcript/types";

export {
  MAX_VOICE_TRANSCRIPTS,
  MAX_VOICE_TRANSCRIPT_LENGTH,
  VOICE_TRANSCRIPT_RETENTION_MS,
  VOICE_TRANSCRIPT_OUTCOMES,
  VOICE_TRANSCRIPT_PENDING_TIMEOUT_MS,
  VOICE_TRANSCRIPT_STATUS_GLYPHS,
  VOICE_TRANSCRIPT_STATUS_SEPARATOR,
  VOICE_TRANSCRIPT_BODY_PREFIX,
  DEFAULT_TRANSCRIPT_TEMPLATE,
} from "./voice-transcript/constants";

export { parseVoiceTranscriptInput, parseVoiceTranscriptReplaceInput } from "./voice-transcript/parse";

export {
  formatRouteLines,
  voiceTranscriptStatus,
  voiceTranscriptModeLabel,
  formatVoiceTranscriptParts,
  formatVoiceTranscriptLine,
} from "./voice-transcript/format-model";
