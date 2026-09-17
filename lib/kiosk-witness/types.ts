/* ------------------------------------------------------------------ *
 * Shape
 * ------------------------------------------------------------------ */

export type KioskAction = {
  at: string;
  /** Grouping bucket, matching `emitDashboardEvent`: "lighting", "heating", … */
  service: string;
  event: string;
  /** One human-readable line, e.g. "Lounge lights on". */
  summary: string;
};

export type KioskSession = {
  sessionId: string;
  /** Enrolled subject id, or null when nobody was recognised. Never a guess. */
  person: string | null;
  score: number | null;
  identifiedAt: string | null;
  openedAt: string;
  lastTouchAt: string;
  actions: KioskAction[];
  /** When a digest was last emitted for this session, if ever. */
  digestSentAt: string | null;
  /**
   * Opaque handle the notifier uses to EDIT the message it already sent rather
   * than post a second one. Survives across a continuation.
   */
  digestRef: string | null;
};

export type WitnessState = {
  open: KioskSession | null;
  recent: KioskSession[];
};


export type WitnessTimings = {
  /** Rolling from the last touch. While it holds, a touch is the same person. */
  identityTtlMs: number;
  /** A gap this long with no touch flushes the session's actions as one digest. */
  digestQuietMs: number;
  /** How many closed sessions to keep. */
  ringSize: number;
};

/**
 * Who to credit for an action right now, and how confident that is.
 *
 * `ageSeconds` travels with the answer deliberately: an action attributed to an
 * observation four minutes old is a weaker claim than one attributed to an
 * observation four seconds old, and the reader should be able to see the
 * difference rather than infer it.
 */
export type KioskIdentity = {
  person: string | null;
  score: number | null;
  sessionId: string | null;
  identifiedAt: string | null;
  ageSeconds: number | null;
};

