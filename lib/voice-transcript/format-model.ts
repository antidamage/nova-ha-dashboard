import {
  DEFAULT_TRANSCRIPT_TEMPLATE,
  TRANSCRIPT_WEEKDAYS,
  VOICE_TRANSCRIPT_BODY_PREFIX,
  VOICE_TRANSCRIPT_PENDING_TIMEOUT_MS,
  VOICE_TRANSCRIPT_STATUS_GLYPHS,
  VOICE_TRANSCRIPT_STATUS_SEPARATOR,
} from "./constants";
import type { VoiceTranscriptEvent, VoiceTranscriptLineParts, VoiceTranscriptRoute, VoiceTranscriptStatus } from "./types";

function displayAgentName(value: string): string {
  const agentName = value.trim() || "Nova";
  return `${agentName.charAt(0).toLocaleUpperCase()}${agentName.slice(1)}`;
}

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
