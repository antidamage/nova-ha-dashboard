export const MAX_VOICE_TRANSCRIPTS = 200;
export const MAX_VOICE_TRANSCRIPT_LENGTH = 4_000;
export const VOICE_TRANSCRIPT_RETENTION_MS = 24 * 60 * 60 * 1_000;

export type VoiceTranscriptRole = "user" | "assistant";

export type VoiceTranscriptEvent = {
  id: string;
  at: string;
  role: VoiceTranscriptRole;
  text: string;
  agentName?: string;
  wakeWords?: string[];
  /** Legacy runtime field retained while older transcript events age out. */
  wakeWord?: string;
  satelliteId?: string;
  roomId?: string;
};

type VoiceTranscriptInput = Omit<VoiceTranscriptEvent, "id"> & { id?: string };

export type VoiceTranscriptReplaceInput = {
  replacesId: string;
  text: string;
  at: string;
};

// Server-generated transcript ids are uuid hex; anything else is ignored so a
// malformed poster cannot collide with existing entries.
const TRANSCRIPT_ID_PATTERN = /^[0-9a-f-]{8,64}$/i;

function optionalTranscriptId(value: unknown): string | undefined {
  return typeof value === "string" && TRANSCRIPT_ID_PATTERN.test(value) ? value : undefined;
}

function optionalLabel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const label = value.trim().slice(0, 64);
  return label || undefined;
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
  const wakeWords = optionalWords(source.wakeWords);
  const wakeWord = optionalLabel(source.wakeWord);
  const satelliteId = optionalLabel(source.satelliteId);
  const roomId = optionalLabel(source.roomId);
  return {
    at: at.toISOString(),
    role: source.role,
    text,
    ...(id ? { id } : {}),
    ...(agentName ? { agentName } : {}),
    ...(wakeWords ? { wakeWords } : {}),
    ...(wakeWord ? { wakeWord } : {}),
    ...(satelliteId ? { satelliteId } : {}),
    ...(roomId ? { roomId } : {}),
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
  return { replacesId, text, at: at.toISOString() };
}

function displayAgentName(value: string): string {
  const agentName = value.trim() || "Nova";
  return `${agentName.charAt(0).toLocaleUpperCase()}${agentName.slice(1)}`;
}

export function formatVoiceTranscriptLine(
  entry: VoiceTranscriptEvent,
  locale?: Intl.LocalesArgument,
  fallbackAgentName = "Nova",
): string {
  const timestamp = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(entry.at));
  const speaker = entry.role === "user"
    ? "User"
    : displayAgentName(entry.agentName || fallbackAgentName);
  return `${timestamp} ${speaker}: ${entry.text}`;
}
