import { describe, expect, it } from "vitest";
import {
  EMPTY_STATE,
  activityView,
  applyAction,
  applyObservation,
  applyTouch,
  currentIdentity,
  digestDue,
  identityHolds,
  markDigestSent,
  type KioskAction,
  type WitnessState,
  type WitnessTimings,
} from "./kiosk-witness";

const TIMINGS: WitnessTimings = {
  identityTtlMs: 30_000,
  digestQuietMs: 10_000,
  ringSize: 5,
};

const T0 = Date.parse("2026-09-03T04:00:00.000Z");
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

function action(offsetMs: number, summary: string): KioskAction {
  return { at: at(offsetMs), service: "lighting", event: "zone-action", summary };
}

/** Open a session with a recognised person at T0. */
function opened(): WitnessState {
  return applyObservation(
    EMPTY_STATE,
    { sessionId: "s1", subject: "adeline", score: 0.61, at: at(0) },
    T0,
    TIMINGS,
  );
}

describe("session opening", () => {
  it("records the person and opens at the observation time", () => {
    const state = opened();
    expect(state.open?.sessionId).toBe("s1");
    expect(state.open?.person).toBe("adeline");
    expect(state.open?.score).toBe(0.61);
    expect(state.open?.identifiedAt).toBe(at(0));
    expect(state.recent).toHaveLength(0);
  });

  it("opens unidentified when nobody was recognised, rather than guessing", () => {
    const state = applyObservation(
      EMPTY_STATE,
      { sessionId: "s1", subject: null, score: null, at: at(0) },
      T0,
      TIMINGS,
    );
    expect(state.open?.person).toBeNull();
    expect(state.open?.identifiedAt).toBeNull();
  });

  it("fills in the person when a retry succeeds, without restarting the session", () => {
    // The daemon retries identification on a later touch in the same session
    // when the opening capture found no face.
    let state = applyObservation(EMPTY_STATE, { sessionId: "s1", subject: null, score: null, at: at(0) }, T0, TIMINGS);
    state = applyObservation(state, { sessionId: "s1", subject: "adeline", score: 0.7, at: at(6_000) }, T0 + 6_000, TIMINGS);
    expect(state.open?.sessionId).toBe("s1");
    expect(state.open?.openedAt).toBe(at(0));
    expect(state.open?.person).toBe("adeline");
    expect(state.recent).toHaveLength(0);
  });

  it("never downgrades a known person back to unidentified", () => {
    // A failed retry after a successful identification must not erase it.
    let state = opened();
    state = applyObservation(state, { sessionId: "s1", subject: null, score: null, at: at(6_000) }, T0 + 6_000, TIMINGS);
    expect(state.open?.person).toBe("adeline");
  });

  it("retires the previous session when a new session id arrives", () => {
    let state = opened();
    state = applyObservation(state, { sessionId: "s2", subject: null, score: null, at: at(60_000) }, T0 + 60_000, TIMINGS);
    expect(state.open?.sessionId).toBe("s2");
    expect(state.recent.map((session) => session.sessionId)).toEqual(["s1"]);
  });

  it("bounds the ring of closed sessions", () => {
    let state = EMPTY_STATE;
    for (let i = 0; i < 9; i += 1) {
      state = applyObservation(state, { sessionId: `s${i}`, subject: null, score: null, at: at(i * 1000) }, T0, TIMINGS);
    }
    expect(state.recent).toHaveLength(TIMINGS.ringSize);
  });
});

describe("the identity window", () => {
  it("extends on touch rather than running from wall time", () => {
    // The whole optimisation: someone working through several controls stays
    // the same person however long they take, as long as they keep touching.
    let state = opened();
    for (let step = 1; step <= 5; step += 1) {
      state = applyTouch(state, { sessionId: "s1", at: at(step * 25_000) }, T0 + step * 25_000, TIMINGS);
    }
    const now = T0 + 5 * 25_000 + 5_000; // 130s after opening, 5s after the last touch
    expect(identityHolds(state.open, now, TIMINGS)).toBe(true);
    expect(currentIdentity(state, now, TIMINGS).person).toBe("adeline");
    // Still one session; no second capture was ever needed.
    expect(state.open?.sessionId).toBe("s1");
    expect(state.recent).toHaveLength(0);
  });

  it("lapses once nobody has touched it for the ttl", () => {
    const state = opened();
    expect(identityHolds(state.open, T0 + 29_000, TIMINGS)).toBe(true);
    expect(identityHolds(state.open, T0 + 31_000, TIMINGS)).toBe(false);
    expect(currentIdentity(state, T0 + 31_000, TIMINGS).person).toBeNull();
  });

  it("reports the age of the identification so a weak claim reads as weak", () => {
    const state = applyTouch(opened(), { sessionId: "s1", at: at(20_000) }, T0 + 20_000, TIMINGS);
    const identity = currentIdentity(state, T0 + 25_000, TIMINGS);
    expect(identity.person).toBe("adeline");
    expect(identity.ageSeconds).toBe(25);
  });

  it("opens an unidentified session when a touch arrives for an unknown one", () => {
    const state = applyTouch(EMPTY_STATE, { sessionId: "s9", at: at(0) }, T0, TIMINGS);
    expect(state.open?.sessionId).toBe("s9");
    expect(state.open?.person).toBeNull();
  });
});

describe("attributing actions", () => {
  it("attaches an action to the current session", () => {
    const state = applyAction(opened(), action(2_000, "Lounge lights on"), T0 + 2_000, TIMINGS);
    expect(state.open?.actions.map((entry) => entry.summary)).toEqual(["Lounge lights on"]);
  });

  it("refuses to attach to a lapsed session rather than making a false claim", () => {
    const state = applyAction(opened(), action(60_000, "Heater on"), T0 + 60_000, TIMINGS);
    expect(state.open?.actions).toHaveLength(0);
  });

  it("does nothing when no session is open", () => {
    expect(applyAction(EMPTY_STATE, action(0, "x"), T0, TIMINGS)).toEqual(EMPTY_STATE);
  });
});

describe("the digest", () => {
  it("is not due while touching continues", () => {
    let state = applyAction(opened(), action(1_000, "Lounge lights on"), T0 + 1_000, TIMINGS);
    state = applyTouch(state, { sessionId: "s1", at: at(8_000) }, T0 + 8_000, TIMINGS);
    expect(digestDue(state, T0 + 12_000, TIMINGS)).toBeNull();
  });

  it("becomes due ten seconds after the last touch", () => {
    let state = opened();
    state = applyAction(state, action(1_000, "Lounge lights on"), T0 + 1_000, TIMINGS);
    state = applyTouch(state, { sessionId: "s1", at: at(2_000) }, T0 + 2_000, TIMINGS);
    expect(digestDue(state, T0 + 11_000, TIMINGS)).toBeNull();
    expect(digestDue(state, T0 + 12_000, TIMINGS)?.sessionId).toBe("s1");
  });

  it("carries everything that was done, in one digest", () => {
    let state = opened();
    state = applyAction(state, action(2_000, "Lounge lights on"), T0 + 2_000, TIMINGS);
    state = applyTouch(state, { sessionId: "s1", at: at(12_000) }, T0 + 12_000, TIMINGS);
    state = applyAction(state, action(14_000, "Heater to 21"), T0 + 14_000, TIMINGS);
    state = applyTouch(state, { sessionId: "s1", at: at(24_000) }, T0 + 24_000, TIMINGS);
    state = applyAction(state, action(25_000, "Aircon off"), T0 + 25_000, TIMINGS);

    const due = digestDue(state, T0 + 36_000, TIMINGS);
    expect(due?.actions.map((entry) => entry.summary)).toEqual([
      "Lounge lights on",
      "Heater to 21",
      "Aircon off",
    ]);
  });

  it("does not fire for a session that did nothing", () => {
    // Somebody woke the panel and walked away. Presence alone is not an event.
    const state = applyTouch(opened(), { sessionId: "s1", at: at(1_000) }, T0 + 1_000, TIMINGS);
    expect(digestDue(state, T0 + 60_000, TIMINGS)).toBeNull();
  });

  it("fires once and then stops", () => {
    let state = applyAction(opened(), action(1_000, "Lounge lights on"), T0 + 1_000, TIMINGS);
    expect(digestDue(state, T0 + 12_000, TIMINGS)).toBeTruthy();
    state = markDigestSent(state, "s1", "msg-1", T0 + 12_000);
    expect(digestDue(state, T0 + 20_000, TIMINGS)).toBeNull();
    expect(digestDue(state, T0 + 600_000, TIMINGS)).toBeNull();
  });

  it("becomes due again for a continuation, keeping the original message ref", () => {
    // A touch fifteen seconds after the digest is OUTSIDE the digest window but
    // INSIDE the identity window: same person, same session, so it edits the
    // message already sent rather than posting a second one.
    let state = applyAction(opened(), action(1_000, "Lounge lights on"), T0 + 1_000, TIMINGS);
    state = markDigestSent(state, "s1", "msg-1", T0 + 12_000);

    state = applyTouch(state, { sessionId: "s1", at: at(27_000) }, T0 + 27_000, TIMINGS);
    expect(state.open?.sessionId).toBe("s1");
    state = applyAction(state, action(28_000, "Aircon off"), T0 + 28_000, TIMINGS);

    const due = digestDue(state, T0 + 40_000, TIMINGS);
    expect(due?.actions).toHaveLength(2);
    expect(due?.digestRef).toBe("msg-1");

    state = markDigestSent(state, "s1", "msg-2", T0 + 40_000);
    // The ref must NOT be replaced: the edit targets the original message.
    expect(state.open?.digestRef).toBe("msg-1");
  });
});

describe("activityView", () => {
  it("flags the open session and lists newest first", () => {
    let state = applyAction(opened(), action(1_000, "Lounge lights on"), T0 + 1_000, TIMINGS);
    state = applyObservation(state, { sessionId: "s2", subject: "adeline", score: 0.6, at: at(90_000) }, T0 + 90_000, TIMINGS);
    const view = activityView(state, T0 + 91_000, TIMINGS);
    expect(view.map((entry) => entry.sessionId)).toEqual(["s2", "s1"]);
    expect(view[0].open).toBe(true);
    expect(view[1].open).toBe(false);
  });

  it("shows a lapsed open session as closed rather than still open", () => {
    const view = activityView(opened(), T0 + 120_000, TIMINGS);
    expect(view[0].open).toBe(false);
  });
});
