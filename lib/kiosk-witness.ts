/**
 * Who is at the wall panel, and what they did while they were there.
 *
 * Nocturnium is a shared kiosk with no login and no way to have one — both LAN
 * vhosts answer a flat 403 with no login path, by design. `callerAttribution()`
 * answers "which machine", which for the panel is the same answer every time.
 * A daemon on Nocturnium identifies the person at its camera by face and posts
 * observations here; this module turns those into sessions and joins control
 * changes to them.
 *
 * `specs/kiosk-attribution.md` owns the design. The consent boundary is that
 * spec's and is not widened here: `/identify` answers `null` for a face it does
 * not know, never a nearest neighbour, so an unrecognised person is recorded as
 * unidentified rather than guessed at.
 *
 * **This records. It does not refuse.** A later gate could read the same join,
 * but nothing here is a switch waiting to be flipped.
 *
 * The pure half sits at the top and takes `now` explicitly, so the state
 * machine is testable without timers or a clock.
 */

import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";

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

export const EMPTY_STATE: WitnessState = { open: null, recent: [] };

export type WitnessTimings = {
  /** Rolling from the last touch. While it holds, a touch is the same person. */
  identityTtlMs: number;
  /** A gap this long with no touch flushes the session's actions as one digest. */
  digestQuietMs: number;
  /** How many closed sessions to keep. */
  ringSize: number;
};

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readTimings(): WitnessTimings {
  return {
    identityTtlMs: intFromEnv("KIOSK_IDENTITY_TTL_SECONDS", 30) * 1000,
    digestQuietMs: intFromEnv("KIOSK_DIGEST_QUIET_SECONDS", 10) * 1000,
    ringSize: intFromEnv("KIOSK_ACTIVITY_RING", 500),
  };
}

/* ------------------------------------------------------------------ *
 * The state machine — pure, `now` passed in
 * ------------------------------------------------------------------ */

function iso(now: number): string {
  return new Date(now).toISOString();
}

function retire(state: WitnessState, timings: WitnessTimings): WitnessState {
  if (!state.open) return state;
  return {
    open: null,
    recent: [state.open, ...state.recent].slice(0, timings.ringSize),
  };
}

/**
 * True while the open session's identity may still be attributed to a new
 * action. Rolling from the LAST TOUCH, not from when the face was seen: someone
 * standing at the panel working through several controls is still the same
 * person however long they take, as long as they keep touching it.
 */
export function identityHolds(
  session: KioskSession | null,
  now: number,
  timings: WitnessTimings,
): session is KioskSession {
  if (!session) return false;
  return now - Date.parse(session.lastTouchAt) <= timings.identityTtlMs;
}

/**
 * The daemon saw someone. A new `sessionId` retires whatever was open; the same
 * one updates the identity in place, which is how a retry after a failed first
 * capture fills in a person without restarting the session.
 */
export function applyObservation(
  state: WitnessState,
  observation: { sessionId: string; subject: string | null; score: number | null; at?: string },
  now: number,
  timings: WitnessTimings,
): WitnessState {
  const at = observation.at ?? iso(now);

  if (state.open && state.open.sessionId === observation.sessionId) {
    return {
      ...state,
      open: {
        ...state.open,
        // Never downgrade a known person back to null: a later retry that fails
        // must not erase an identification that already succeeded.
        person: observation.subject ?? state.open.person,
        score: observation.subject ? observation.score : state.open.score,
        identifiedAt: observation.subject ? at : state.open.identifiedAt,
        lastTouchAt: at,
      },
    };
  }

  const retired = retire(state, timings);
  return {
    ...retired,
    open: {
      sessionId: observation.sessionId,
      person: observation.subject,
      score: observation.score,
      identifiedAt: observation.subject ? at : null,
      openedAt: at,
      lastTouchAt: at,
      actions: [],
      digestSentAt: null,
      digestRef: null,
    },
  };
}

/**
 * A bare touch ping: someone is still there, no capture was taken.
 *
 * A touch for an unknown session opens one with no identity. That happens when
 * the daemon's `/identify` failed outright, and an unattributed session is a
 * better record than none.
 */
export function applyTouch(
  state: WitnessState,
  touch: { sessionId: string; at?: string },
  now: number,
  timings: WitnessTimings,
): WitnessState {
  const at = touch.at ?? iso(now);
  if (state.open && state.open.sessionId === touch.sessionId) {
    return { ...state, open: { ...state.open, lastTouchAt: at } };
  }
  return applyObservation(state, { sessionId: touch.sessionId, subject: null, score: null, at }, now, timings);
}

/**
 * Attribute a control change to whoever is at the panel.
 *
 * Returns the state unchanged when there is no current session — a control
 * changed from a phone on the tailnet is not the kiosk, and an action attached
 * to a stale session would be a false claim.
 */
export function applyAction(
  state: WitnessState,
  action: KioskAction,
  now: number,
  timings: WitnessTimings,
): WitnessState {
  if (!identityHolds(state.open, now, timings)) return state;
  return {
    ...state,
    open: { ...state.open, actions: [...state.open.actions, action] },
  };
}

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

export const NO_IDENTITY: KioskIdentity = {
  person: null,
  score: null,
  sessionId: null,
  identifiedAt: null,
  ageSeconds: null,
};

export function currentIdentity(
  state: WitnessState,
  now: number,
  timings: WitnessTimings,
): KioskIdentity {
  if (!identityHolds(state.open, now, timings)) return NO_IDENTITY;
  const session = state.open;
  return {
    person: session.person,
    score: session.score,
    sessionId: session.sessionId,
    identifiedAt: session.identifiedAt,
    ageSeconds: session.identifiedAt
      ? Math.max(0, Math.round((now - Date.parse(session.identifiedAt)) / 1000))
      : null,
  };
}

/**
 * The session whose digest is due, or null.
 *
 * Due means: quiet for long enough, and it has something to report. A session
 * that accumulated no actions never produces a digest — somebody woke the panel
 * and walked away, and presence on its own is not worth a notification.
 *
 * A session that has already sent a digest becomes due AGAIN once further
 * actions arrive, which is the continuation case: a touch inside the identity
 * window but after the digest went out belongs to the same person and the same
 * session, so it edits the message already sent rather than posting a second.
 */
export function digestDue(
  state: WitnessState,
  now: number,
  timings: WitnessTimings,
): KioskSession | null {
  const session = state.open;
  if (!session) return null;
  if (session.actions.length === 0) return null;
  if (now - Date.parse(session.lastTouchAt) < timings.digestQuietMs) return null;
  if (session.digestSentAt && Date.parse(session.digestSentAt) >= Date.parse(session.actions[session.actions.length - 1].at)) {
    // Everything in this session has already been reported.
    return null;
  }
  return session;
}

export function markDigestSent(
  state: WitnessState,
  sessionId: string,
  digestRef: string | null,
  now: number,
): WitnessState {
  if (!state.open || state.open.sessionId !== sessionId) return state;
  return {
    ...state,
    open: {
      ...state.open,
      digestSentAt: iso(now),
      // Keep the first ref: a continuation must edit the ORIGINAL message.
      digestRef: state.open.digestRef ?? digestRef,
    },
  };
}

/** Newest first, open session included and flagged. */
export function activityView(
  state: WitnessState,
  now: number,
  timings: WitnessTimings,
): Array<KioskSession & { open: boolean }> {
  const open = state.open ? [{ ...state.open, open: identityHolds(state.open, now, timings) }] : [];
  return [...open, ...state.recent.map((session) => ({ ...session, open: false }))];
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

const STORE_DIR = process.env.NOVA_KIOSK_WITNESS_DIR
  ?? path.join(process.cwd(), "data", "kiosk-witness");
const STORE_PATH = path.join(STORE_DIR, "state.json");

let cache: WitnessState | null = null;

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function loadState(): Promise<WitnessState> {
  if (cache) return cache;
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as WitnessState;
    cache = {
      open: parsed.open ?? null,
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
    };
  } catch {
    // No file yet, or an unreadable one. An attribution store is not worth
    // failing a page load over.
    cache = EMPTY_STATE;
  }
  return cache;
}

export async function saveState(next: WitnessState): Promise<void> {
  cache = next;
  try {
    await writeJsonAtomic(STORE_PATH, next);
  } catch {
    // Fire-and-forget, same contract as the event spool: a witness hiccup must
    // never delay or fail a device command.
  }
}

/** For tests: drop the in-process cache. */
export function resetCache(): void {
  cache = null;
}
