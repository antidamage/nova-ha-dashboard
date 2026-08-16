export const MAX_VOICE_TRANSCRIPTS = 200;
export const MAX_VOICE_TRANSCRIPT_LENGTH = 4_000;
export const VOICE_TRANSCRIPT_RETENTION_MS = 24 * 60 * 60 * 1_000;

export type VoiceTranscriptRole = "user" | "assistant";

/**
 * Whether a turn executed/shadowed a dashboard command, was conversational, or
 * is a non-spoken "*Thinking*" marker posted while a device-verification loop
 * is still polling (see nova-voice's bounded wiggum loop).
 */
export type VoiceTranscriptKind = "command" | "exchange" | "thinking";

/**
 * What became of the turn. `kind` says whether it was a command; it cannot say
 * whether the command ran, so a command that took effect, one withheld by
 * shadow mode or a dry run, and one that failed all look identical without
 * this.
 */
export const VOICE_TRANSCRIPT_OUTCOMES = [
  "executed",
  "dry-run",
  "shadowed",
  "failed",
  "ignored",
  "answered",
] as const;

export type VoiceTranscriptOutcome = (typeof VOICE_TRANSCRIPT_OUTCOMES)[number];

/**
 * How long a user line may sit without an outcome before it is read as having
 * failed. Every turn now resolves its line, so an unresolved one means the
 * runtime died mid-turn — that is a failure, not an eternal working state.
 */
export const VOICE_TRANSCRIPT_PENDING_TIMEOUT_MS = 2 * 60 * 1_000;

/** Working / succeeded / failed, as shown after the question body. */
export type VoiceTranscriptStatus = "working" | "success" | "failure";

export const VOICE_TRANSCRIPT_STATUS_GLYPHS: Record<VoiceTranscriptStatus, string> = {
  working: "🧰",
  success: "⭕",
  failure: "❌",
};

/** Gap between the question text and its status glyph. */
export const VOICE_TRANSCRIPT_STATUS_SEPARATOR = "   ";

export type VoiceTranscriptEvent = {
  id: string;
  at: string;
  role: VoiceTranscriptRole;
  text: string;
  agentName?: string;
  /** Recognized local speaker-profile name for user turns. */
  speakerName?: string;
  kind?: VoiceTranscriptKind;
  outcome?: VoiceTranscriptOutcome;
  /** The interpreter's verdict for this turn: execute, reply, clarify, ignore. */
  decision?: string;
  wakeWords?: string[];
  /** Legacy runtime field retained while older transcript events age out. */
  wakeWord?: string;
  satelliteId?: string;
  roomId?: string;
  /**
   * Which stack ran each reasoning pass of this turn, in order.
   *
   * Carries no content — only the pass name, where it ran and how long it
   * took — so it is safe to show on every line. A pass appearing twice means
   * both stacks processed it, which is the thing that is otherwise impossible
   * to tell apart from a single slow turn.
   */
  routes?: VoiceTranscriptRoute[];
};

export type VoiceTranscriptRoute = {
  pass: string;
  source: string;
  ms: number;
};

type VoiceTranscriptInput = Omit<VoiceTranscriptEvent, "id"> & { id?: string };

export type VoiceTranscriptReplaceInput = {
  replacesId: string;
  text: string;
  at: string;
  kind?: VoiceTranscriptKind;
  outcome?: VoiceTranscriptOutcome;
  decision?: string;
  speakerName?: string;
};

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
  /** Carried through so a failed or withheld turn can be styled differently. */
  outcome?: VoiceTranscriptOutcome;
  /** Working/succeeded/failed, for styling; absent when nothing is claimed. */
  status?: VoiceTranscriptStatus;
  /** The glyph itself, already spaced away from the body text. */
  statusGlyph?: string;
  /**
   * One line per stack that ran something, e.g.
   * `server  interpret 3.5s · render_response 1.2s  = 4.7s`.
   *
   * Empty when no routed pass ran. Both lines present means both stacks
   * processed the turn — which is the whole reason this is rendered on every
   * line rather than only while comparison mode is on.
   */
  routeLines?: string[];
};

/**
 * The route chain as one line per stack.
 *
 * Grouped by *where* rather than listed in execution order, because the
 * question being asked is "what did each stack cost me for this turn" — and
 * two interleaved lists make that a subtraction the reader has to do in their
 * head. Each line ends with that stack's total, which is the number an
 * offloading decision actually turns on.
 *
 * A stack that ran nothing gets no line, so a turn served entirely by one side
 * stays a single line rather than implying a comparison that never happened.
 */
export function formatRouteLines(routes: VoiceTranscriptRoute[] | undefined): string[] {
  if (!routes?.length) return [];
  // "device" and "server", not "companion" and "local" — the pair has to read
  // as two places at a glance.
  const stacks = [
    { label: "server", source: "local" },
    { label: "device", source: "companion" },
  ];
  const lines: string[] = [];
  for (const stack of stacks) {
    const mine = routes.filter((route) => route.source === stack.source);
    if (!mine.length) continue;
    const parts = mine.map((route) => `${route.pass} ${formatRouteMs(route.ms)}`);
    const total = mine.reduce((sum, route) => sum + route.ms, 0);
    // A total that would just repeat the only figure on the line is noise.
    const suffix = mine.length > 1 ? `  = ${formatRouteMs(total)}` : "";
    lines.push(`${stack.label}  ${parts.join(" · ")}${suffix}`);
  }
  return lines;
}

function formatRouteMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/**
 * What to show after the question. A turn in flight is working; once it
 * resolves only a command turn makes a success/failure claim, because an
 * exchange has nothing to have succeeded or failed at. Assistant lines never
 * carry a marker — the claim belongs to the question, not the reply.
 */
export function voiceTranscriptStatus(
  entry: VoiceTranscriptEvent,
  now: Date = new Date(),
): VoiceTranscriptStatus | undefined {
  if (entry.role !== "user") {
    return undefined;
  }
  if (!entry.outcome) {
    // No outcome yet: in flight, until it has been waiting long enough that
    // the turn plainly never came back.
    const waited = now.getTime() - new Date(entry.at).getTime();
    return waited >= VOICE_TRANSCRIPT_PENDING_TIMEOUT_MS ? "failure" : "working";
  }
  if (entry.kind !== "command") {
    return undefined;
  }
  // A dry run or a shadowed command was understood and resolved; only the
  // header tag needs to say it was withheld.
  return entry.outcome === "failed" || entry.outcome === "ignored" ? "failure" : "success";
}

/**
 * The `%m%` label. A command that ran and one that failed must not read the
 * same, so a command turn's outcome qualifies the tag — but only when it says
 * something the tag does not: a plain executed command stays "COMMAND".
 */
export function voiceTranscriptModeLabel(entry: VoiceTranscriptEvent): string {
  if (entry.kind === "thinking") {
    return "THINKING";
  }
  if (entry.kind !== "command") {
    return "EXCHANGE";
  }
  switch (entry.outcome) {
    case "failed":
      return "COMMAND FAILED";
    case "dry-run":
      return "COMMAND DRY-RUN";
    case "shadowed":
      return "COMMAND SHADOWED";
    default:
      return "COMMAND";
  }
}

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
  now: Date = new Date(),
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
    "%m%": voiceTranscriptModeLabel(entry),
  };
  const prefix = template.replace(/%[uadtm]%/g, (token) => substitutions[token] ?? token);
  const status = voiceTranscriptStatus(entry, now);
  return {
    prefix,
    bodyPrefix: VOICE_TRANSCRIPT_BODY_PREFIX,
    text: entry.text,
    role: entry.role,
    ...(entry.outcome ? { outcome: entry.outcome } : {}),
    ...(status
      ? { status, statusGlyph: VOICE_TRANSCRIPT_STATUS_GLYPHS[status] }
      : {}),
    ...(formatRouteLines(entry.routes).length
      ? { routeLines: formatRouteLines(entry.routes) }
      : {}),
  };
}

export function formatVoiceTranscriptLine(
  entry: VoiceTranscriptEvent,
  fallbackAgentName = "Nova",
  template = DEFAULT_TRANSCRIPT_TEMPLATE,
  now: Date = new Date(),
): string {
  const { prefix, bodyPrefix, text, statusGlyph } = formatVoiceTranscriptParts(
    entry,
    fallbackAgentName,
    template,
    now,
  );
  const status = statusGlyph ? `${VOICE_TRANSCRIPT_STATUS_SEPARATOR}${statusGlyph}` : "";
  return `${prefix}\n${bodyPrefix}${text}${status}`;
}
