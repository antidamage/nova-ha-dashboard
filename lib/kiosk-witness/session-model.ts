// Pure: the witness state machine. Every function takes `now` explicitly.
import { NO_IDENTITY } from "./constants";
import type { KioskAction, KioskIdentity, KioskSession, WitnessState, WitnessTimings } from "./types";

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
