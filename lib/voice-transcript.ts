export const MAX_VOICE_TRANSCRIPTS = 200;
export const MAX_VOICE_TRANSCRIPT_LENGTH = 4_000;
export const VOICE_TRANSCRIPT_RETENTION_MS = 24 * 60 * 60 * 1_000;

export type VoiceTranscriptRole = "user" | "assistant";

/** Whether a turn executed/shadowed a dashboard command or was conversational. */
export type VoiceTranscriptKind = "command" | "exchange";

export type VoiceTranscriptEvent = {
  id: string;
  at: string;
  role: VoiceTranscriptRole;
  text: string;
  agentName?: string;
  /** Recognized local speaker-profile name for user turns. */
  speakerName?: string;
  kind?: VoiceTranscriptKind;
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
  kind?: VoiceTranscriptKind;
  speakerName?: string;
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

function optionalKind(value: unknown): VoiceTranscriptKind | undefined {
  return value === "command" || value === "exchange" ? value : undefined;
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
    ...(speakerName ? { speakerName } : {}),
    ...(kind ? { kind } : {}),
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
  const kind = optionalKind(source.kind);
  const speakerName = optionalLabel(source.speakerName);
  return {
    replacesId,
    text,
    at: at.toISOString(),
    ...(kind ? { kind } : {}),
    ...(speakerName ? { speakerName } : {}),
  };
}

function displayAgentName(value: string): string {
  const agentName = value.trim() || "Nova";
  return `${agentName.charAt(0).toLocaleUpperCase()}${agentName.slice(1)}`;
}

export type VoiceTranscriptLineParts = {
  /** "╭─[ <SPEAKER> ➤ <local date/time> ➤ [COMMAND|EXCHANGE] ]" header line. */
  prefix: string;
  /** "╰─ " lead-in for the message body line. */
  bodyPrefix: string;
  text: string;
  role: VoiceTranscriptRole;
};

const TRANSCRIPT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const VOICE_TRANSCRIPT_BODY_PREFIX = "╰─ ";

/**
 * Header decoration template. Tokens: %u% — the user speaker label (only on
 * user lines), %a% — the agent speaker label (only on agent lines), %d% —
 * date, %t% — time, %m% — COMMAND/EXCHANGE. The default reproduces the
 * original hard-coded decoration exactly.
 */
export const DEFAULT_TRANSCRIPT_TEMPLATE = "╭─[ %u%%a% ➤ %d% %t% ➤ [%m%] ]";

// "2026-07-18 Sat" / "2:57pm" in the viewer's local time. Built by hand (not
// Intl) so the layout is identical on every host regardless of locale data.
function transcriptDate(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + ` ${TRANSCRIPT_WEEKDAYS[date.getDay()]}`;
}

function transcriptTime(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  const hour = date.getHours() % 12 || 12;
  const meridiem = date.getHours() < 12 ? "am" : "pm";
  return `${hour}:${pad(date.getMinutes())}${meridiem}`;
}

// Split out from formatVoiceTranscriptLine so the decorated header can be
// wrapped in its own element and styled independently of the message body —
// a plain concatenated string has no DOM node for CSS to target. The role is
// threaded through too, so the renderer can style user vs. agent lines
// differently instead of both looking identical.
export function formatVoiceTranscriptParts(
  entry: VoiceTranscriptEvent,
  fallbackAgentName = "Nova",
  template = DEFAULT_TRANSCRIPT_TEMPLATE,
): VoiceTranscriptLineParts {
  const date = new Date(entry.at);
  // One template serves both roles, so the speaker tokens are conditional:
  // %u% is empty on agent lines and %a% is empty on user lines. Substituted
  // in a single pass so replacement values are never re-scanned for tokens.
  const substitutions: Record<string, string> = {
    "%u%": entry.role === "user" ? (entry.speakerName || "USER") : "",
    "%a%": entry.role === "user"
      ? ""
      : displayAgentName(entry.agentName || fallbackAgentName).toLocaleUpperCase(),
    "%d%": transcriptDate(date),
    "%t%": transcriptTime(date),
    "%m%": entry.kind === "command" ? "COMMAND" : "EXCHANGE",
  };
  const prefix = template.replace(/%[uadtm]%/g, (token) => substitutions[token] ?? token);
  return { prefix, bodyPrefix: VOICE_TRANSCRIPT_BODY_PREFIX, text: entry.text, role: entry.role };
}

export function formatVoiceTranscriptLine(
  entry: VoiceTranscriptEvent,
  fallbackAgentName = "Nova",
  template = DEFAULT_TRANSCRIPT_TEMPLATE,
): string {
  const { prefix, bodyPrefix, text } = formatVoiceTranscriptParts(entry, fallbackAgentName, template);
  return `${prefix}\n${bodyPrefix}${text}`;
}
