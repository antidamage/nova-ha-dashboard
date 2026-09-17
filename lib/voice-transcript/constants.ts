import type { VoiceTranscriptOutcome, VoiceTranscriptStatus } from "./types";

export const MAX_VOICE_TRANSCRIPTS = 200;
export const MAX_VOICE_TRANSCRIPT_LENGTH = 4_000;
export const VOICE_TRANSCRIPT_RETENTION_MS = 24 * 60 * 60 * 1_000;

/**
 * What became of the turn. `kind` says whether it was a command; it cannot say
 * whether the command ran, so a command that took effect, one withheld by
 * shadow mode or a dry run, and one that failed all look identical without
 * this.
 */
export const VOICE_TRANSCRIPT_OUTCOMES: readonly VoiceTranscriptOutcome[] = [
  "executed",
  "dry-run",
  "shadowed",
  "failed",
  "ignored",
  "answered",
] as const;

/**
 * How long a user line may sit without an outcome before it is read as having
 * failed. Every turn now resolves its line, so an unresolved one means the
 * runtime died mid-turn — that is a failure, not an eternal working state.
 */
export const VOICE_TRANSCRIPT_PENDING_TIMEOUT_MS = 2 * 60 * 1_000;

export const VOICE_TRANSCRIPT_STATUS_GLYPHS: Record<VoiceTranscriptStatus, string> = {
  working: "🧰",
  success: "⭕",
  failure: "❌",
};

/** Gap between the question text and its status glyph. */
export const VOICE_TRANSCRIPT_STATUS_SEPARATOR = "   ";

export const TRANSCRIPT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const VOICE_TRANSCRIPT_BODY_PREFIX = "╰─ ";

/**
 * Header decoration template. Tokens: %u% — the user speaker label (only on
 * user lines), %a% — the agent speaker label (only on agent lines), %d% —
 * date, %t% — time, %m% — COMMAND/EXCHANGE. The default reproduces the
 * original hard-coded decoration exactly.
 */
export const DEFAULT_TRANSCRIPT_TEMPLATE = "╭─[ %u%%a% ➤ %d% %t% ➤ [%m%] ]";
