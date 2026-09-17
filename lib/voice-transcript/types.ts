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
 * this. Kept in sync by hand with the `VOICE_TRANSCRIPT_OUTCOMES` runtime
 * list in ./constants.ts, which is what parsing validates against.
 */
export type VoiceTranscriptOutcome = "executed" | "dry-run" | "shadowed" | "failed" | "ignored" | "answered";

/** Working / succeeded / failed, as shown after the question body. */
export type VoiceTranscriptStatus = "working" | "success" | "failure";

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

export type VoiceTranscriptInput = Omit<VoiceTranscriptEvent, "id"> & { id?: string };

export type VoiceTranscriptReplaceInput = {
  replacesId: string;
  text: string;
  at: string;
  kind?: VoiceTranscriptKind;
  outcome?: VoiceTranscriptOutcome;
  decision?: string;
  speakerName?: string;
};

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
