import { MAX_VOICE_TRANSCRIPT_LENGTH, VOICE_TRANSCRIPT_OUTCOMES } from "./constants";
import type {
  VoiceTranscriptInput,
  VoiceTranscriptKind,
  VoiceTranscriptOutcome,
  VoiceTranscriptReplaceInput,
  VoiceTranscriptRoute,
} from "./types";

// Server-generated transcript ids are uuid hex; anything else is ignored so a
// malformed poster cannot collide with existing entries.
const TRANSCRIPT_ID_PATTERN = /^[0-9a-f-]{8,64}$/i;

function optionalTranscriptId(value: unknown): string | undefined {
  return typeof value === "string" && TRANSCRIPT_ID_PATTERN.test(value) ? value : undefined;
}

/**
 * The route chain, kept only when every entry is well formed.
 *
 * Bounded at eight: a turn runs a handful of passes, and anything longer is a
 * bug upstream rather than something worth rendering. A malformed entry drops
 * the whole chain rather than showing a partial one — a chain missing a hop is
 * worse than no chain, because the question it answers is "did anything else
 * also run".
 */
function optionalRoutes(value: unknown): VoiceTranscriptRoute[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const routes: VoiceTranscriptRoute[] = [];
  for (const entry of value.slice(0, 8)) {
    if (!entry || typeof entry !== "object") return undefined;
    const record = entry as Record<string, unknown>;
    const pass = optionalLabel(record.pass);
    const source = optionalLabel(record.source);
    const ms = typeof record.ms === "number" && Number.isFinite(record.ms) ? record.ms : null;
    if (!pass || !source || ms === null) return undefined;
    routes.push({ pass, source, ms });
  }
  return routes;
}

function optionalLabel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const label = value.trim().slice(0, 64);
  return label || undefined;
}

function optionalKind(value: unknown): VoiceTranscriptKind | undefined {
  return value === "command" || value === "exchange" || value === "thinking"
    ? value
    : undefined;
}

function optionalOutcome(value: unknown): VoiceTranscriptOutcome | undefined {
  return VOICE_TRANSCRIPT_OUTCOMES.includes(value as VoiceTranscriptOutcome)
    ? (value as VoiceTranscriptOutcome)
    : undefined;
}

function optionalDecision(value: unknown): string | undefined {
  return value === "execute" || value === "reply" || value === "clarify" || value === "ignore"
    ? value
    : undefined;
}

function optionalWords(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const words = value
    .filter((word): word is string => typeof word === "string")
    .map((word) => word.trim().slice(0, 24))
    .filter(Boolean)
    .slice(0, 12);
  return words.length ? words : undefined;
}

export function parseVoiceTranscriptInput(
  value: unknown,
  now: Date = new Date(),
): VoiceTranscriptInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Transcript body must be an object");
  }
  const source = value as Record<string, unknown>;
  if (source.role !== "user" && source.role !== "assistant") {
    throw new Error("Transcript role must be user or assistant");
  }
  if (typeof source.text !== "string") {
    throw new Error("Transcript text is required");
  }
  const text = source.text.trim();
  if (!text) {
    throw new Error("Transcript text is required");
  }
  if (text.length > MAX_VOICE_TRANSCRIPT_LENGTH) {
    throw new Error(`Transcript text must be at most ${MAX_VOICE_TRANSCRIPT_LENGTH} characters`);
  }

  const suppliedAt = typeof source.at === "string" ? new Date(source.at) : now;
  const at = Number.isNaN(suppliedAt.getTime()) ? now : suppliedAt;
  const id = optionalTranscriptId(source.id);
  const agentName = optionalLabel(source.agentName);
  const speakerName = optionalLabel(source.speakerName);
  const kind = optionalKind(source.kind);
  const outcome = optionalOutcome(source.outcome);
  const decision = optionalDecision(source.decision);
  const wakeWords = optionalWords(source.wakeWords);
  const wakeWord = optionalLabel(source.wakeWord);
  const satelliteId = optionalLabel(source.satelliteId);
  const roomId = optionalLabel(source.roomId);
  const routes = optionalRoutes(source.routes);
  return {
    at: at.toISOString(),
    role: source.role,
    text,
    ...(id ? { id } : {}),
    ...(agentName ? { agentName } : {}),
    ...(speakerName ? { speakerName } : {}),
    ...(kind ? { kind } : {}),
    ...(outcome ? { outcome } : {}),
    ...(decision ? { decision } : {}),
    ...(wakeWords ? { wakeWords } : {}),
    ...(wakeWord ? { wakeWord } : {}),
    ...(satelliteId ? { satelliteId } : {}),
    ...(roomId ? { roomId } : {}),
    ...(routes ? { routes } : {}),
  };
}

export function parseVoiceTranscriptReplaceInput(
  value: unknown,
  now: Date = new Date(),
): VoiceTranscriptReplaceInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Transcript body must be an object");
  }
  const source = value as Record<string, unknown>;
  const replacesId = optionalTranscriptId(source.replacesId);
  if (!replacesId) {
    throw new Error("Transcript replacesId is invalid");
  }
  if (typeof source.text !== "string" || !source.text.trim()) {
    throw new Error("Transcript text is required");
  }
  const text = source.text.trim();
  if (text.length > MAX_VOICE_TRANSCRIPT_LENGTH) {
    throw new Error(`Transcript text must be at most ${MAX_VOICE_TRANSCRIPT_LENGTH} characters`);
  }
  const suppliedAt = typeof source.at === "string" ? new Date(source.at) : now;
  const at = Number.isNaN(suppliedAt.getTime()) ? now : suppliedAt;
  const kind = optionalKind(source.kind);
  const outcome = optionalOutcome(source.outcome);
  const decision = optionalDecision(source.decision);
  const speakerName = optionalLabel(source.speakerName);
  return {
    replacesId,
    text,
    at: at.toISOString(),
    ...(kind ? { kind } : {}),
    ...(outcome ? { outcome } : {}),
    ...(decision ? { decision } : {}),
    ...(speakerName ? { speakerName } : {}),
  };
}
