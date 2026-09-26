"use client";

// What this DOCUMENT knows about builds, and what it should do about a build id
// the server reports.
//
// It lives here, apart from the hook that uses it, for one reason: the shell
// mounts that hook from more than one component (the design host, Dashboard and
// the accent config section), and every copy has to reach the same decision.
// These are facts about the document, not about a hook call — so they are one
// copy of module state, and the policy is a function of it.
//
// The rule (specs/ui-shell.md, "Reloads on a returned page"):
//
//   hidden                            -> reload now: nobody is looking, and a
//                                        current page is the point
//   visible, has been hidden before   -> defer: remember it, apply it at the
//                                        next transition to hidden, so it is
//                                        current before it is looked at again
//   visible, never been hidden        -> reload now, as the wall displays always
//                                        did; they never "return", and they must
//                                        not sit on a stale bundle
//   first id / same id / unreadable   -> nothing

export type BuildReloadDecision = "adopt" | "none" | "reload" | "defer";

/**
 * How long a page must stay hidden before a remembered build change is applied.
 *
 * One tick of grace, because a hidden transition is not always a backgrounding:
 * it is also what happens as the document LEAVES — a link the person clicked, a
 * tab they closed. A reload issued into that race would cancel or double the
 * navigation they asked for, so the reload is scheduled rather than immediate,
 * re-checks that the page is still hidden, and a terminal `pagehide` cancels it.
 */
export const HIDDEN_RELOAD_GRACE_MS = 1_000;

// The newest build id the server has told this document about (the 60s
// /api/version poll or an SSE "build" event, whichever lands first) — the page's
// own view of the channel, which is what the reload tests read. Null until the
// first id arrives.
let lastKnownBuildId: string | null = null;

// The build this document is RUNNING. Set the first time an id is ever seen and
// never overwritten, because the only thing that changes it is a reload, and a
// reload starts a new document. The outage blocker compares the served build
// against this one.
let runningBuildId: string | null = null;

// A build this document has been told about but is not allowed to apply yet.
let pendingBuildId: string | null = null;

// When this document FIRST learned it was serving a superseded build. Kept
// across a change of which build that is: a display that has been stale through
// two releases has been stale since the first of them, which is the number that
// makes an unbounded deferral reportable.
let supersededSinceAt: number | null = null;

// Whether a reload has already been issued for this document. Several copies of
// the hook are mounted at once and each polls, so without this a visible page
// would reload once per copy.
let reloadIssued = false;

// Whether this document has ever been in the background. A page that has been is
// one somebody comes back to, and must not be reloaded as they arrive.
let hasBeenHidden = false;

export function getLastKnownBuildId() {
  return lastKnownBuildId;
}

export function getRunningBuildId() {
  return runningBuildId;
}

export function getPendingBuildId() {
  return pendingBuildId;
}

/** How long this document has been serving a superseded build, or null. */
export function getSupersededAgeMs() {
  return supersededSinceAt === null ? null : Date.now() - supersededSinceAt;
}

export function hasReloadBeenIssued() {
  return reloadIssued;
}

/**
 * Stop every copy of the hook reloading: a reload has been issued, and the
 * document will not exist in a moment.
 */
export function noteReloadIssued() {
  reloadIssued = true;
}

export function hasEverBeenHidden() {
  return hasBeenHidden;
}

export function noteHeardBuildId(buildId: string) {
  lastKnownBuildId = buildId;
}

export function noteHidden() {
  hasBeenHidden = true;
}

/** The document's first id: what it is running until a reload replaces it. */
export function adoptRunningBuildId(buildId: string) {
  runningBuildId ??= buildId;
}

export function rememberPendingBuildId(buildId: string) {
  // Stamp when the document FIRST became superseded, not when this particular
  // build did: the deferral is re-decided on every poll, and a later release
  // changes the id again, so stamping per id would report the age of the newest
  // one and let release churn keep the number near zero forever.
  if (supersededSinceAt === null) {
    supersededSinceAt = Date.now();
  }
  pendingBuildId = buildId;
}

export function clearPendingBuildId() {
  pendingBuildId = null;
  supersededSinceAt = null;
}

/**
 * What to do about a build id the server has reported, given what the document
 * knows. A pure function of its inputs, so the table above can be tested without
 * a browser.
 */
export function decideBuildReload(input: {
  pageBuildId: string | null;
  serverBuildId: string | null;
  hidden: boolean;
  hasBeenHidden: boolean;
}): BuildReloadDecision {
  const serverBuildId = input.serverBuildId ?? "";
  if (!serverBuildId) {
    return "none";
  }
  if (input.pageBuildId === null) {
    return "adopt";
  }
  if (input.pageBuildId === serverBuildId) {
    return "none";
  }
  if (input.hidden) {
    return "reload";
  }
  return input.hasBeenHidden ? "defer" : "reload";
}

/**
 * Test-only: the state above describes a DOCUMENT and lives for its lifetime, so
 * a test that wants a fresh page has to say so. Nothing in the app calls this —
 * in the browser, a new document gets a new module instance.
 */
export function resetBuildReloadStateForTests() {
  lastKnownBuildId = null;
  runningBuildId = null;
  pendingBuildId = null;
  supersededSinceAt = null;
  hasBeenHidden = false;
  reloadIssued = false;
}
