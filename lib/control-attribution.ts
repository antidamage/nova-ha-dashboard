/**
 * One place where a control mutation is recorded, and one place where it gains
 * a person.
 *
 * `request-attribution.ts` answers "which machine" — an address and a user
 * agent — and that was enough for the incident it was built for. It is not
 * enough for the wall panel, where the answer is identical on every tap. This
 * module joins a kiosk-originated write to the face observation for whoever the
 * witness saw standing there, and emits the same dashboard event either way.
 *
 * `specs/kiosk-attribution.md` owns the design; §Route inventory is the list of
 * callers this is supposed to have, and a control route that does not call it
 * is a gap.
 *
 * **Fire-and-forget, always.** `event-spool.ts` states the contract — a
 * monitoring hiccup must never delay or fail a device command — and the witness
 * join inherits it. Nothing in here throws into a caller.
 */

import { emitDashboardEvent, type DashboardEventPhase } from "./event-spool";
import { emitModuleEvent } from "./modules/runtime/hooks";
import { callerAttribution, type CallerAttribution } from "./request-attribution";
import {
  NO_IDENTITY,
  applyAction,
  currentIdentity,
  digestDue,
  loadState,
  markDigestSent,
  readTimings,
  saveState,
  type KioskIdentity,
} from "./kiosk-witness";
import { readDashboardConfig } from "./dashboard-config";

/* ------------------------------------------------------------------ *
 * Is this the kiosk?
 * ------------------------------------------------------------------ */

const ADDRESS_TTL_MS = 60_000;
let addressCache: { at: number; addresses: Set<string> } | null = null;

/**
 * Kiosk addresses, memoised.
 *
 * `readDashboardConfig()` reads three files and revalidates on every call, and
 * this runs on every device command, so it is cached for a minute. A minute is
 * chosen because these addresses change when a DHCP reservation changes — a
 * once-a-year event — and a stale minute costs only that the first taps after a
 * change go unattributed.
 */
async function kioskAddresses(): Promise<Set<string>> {
  const now = Date.now();
  if (addressCache && now - addressCache.at < ADDRESS_TTL_MS) return addressCache.addresses;
  try {
    const config = await readDashboardConfig();
    const listed = config.dashboard?.kiosk?.addresses ?? [];
    addressCache = { at: now, addresses: new Set(listed.filter(Boolean)) };
  } catch {
    // A config that will not load must not take device control with it.
    addressCache = { at: now, addresses: addressCache?.addresses ?? new Set() };
  }
  return addressCache.addresses;
}

/** For tests, and for a config change that should take effect immediately. */
export function resetKioskAddressCache(): void {
  addressCache = null;
}

export async function isKioskCaller(caller: CallerAttribution): Promise<boolean> {
  if (!caller.ip) return false;
  return (await kioskAddresses()).has(caller.ip);
}

/* ------------------------------------------------------------------ *
 * Attribution
 * ------------------------------------------------------------------ */

export type ControlAttribution = {
  /** Grouping bucket for Grafana: "lighting", "heating", "climate", "system". */
  service: string;
  /** Event name, e.g. "zone-action", "bedroom-heater-update". */
  event: string;
  /** One human-readable line for the digest and the activity panel. */
  summary: string;
  phase?: DashboardEventPhase;
  detail?: Record<string, string | number | boolean | null | undefined>;
};

/**
 * Record one control mutation: who, what, and — when it came from the panel —
 * which person.
 *
 * Returns the identity it resolved so a caller can use it, but most callers
 * ignore the result. Never throws.
 */
export async function attributeControl(
  request: Request,
  input: ControlAttribution,
): Promise<KioskIdentity> {
  const caller = callerAttribution(request);
  let identity: KioskIdentity = NO_IDENTITY;

  try {
    if (await isKioskCaller(caller)) {
      const timings = readTimings();
      const now = Date.now();
      const state = await loadState();
      identity = currentIdentity(state, now, timings);
      const next = applyAction(
        state,
        { at: new Date(now).toISOString(), service: input.service, event: input.event, summary: input.summary },
        now,
        timings,
      );
      if (next !== state) await saveState(next);
    }
  } catch {
    // An attribution failure degrades to address-only. It never costs the
    // command.
  }

  try {
    await emitDashboardEvent({
      service: input.service,
      event: input.event,
      source: "user",
      phase: input.phase ?? "point",
      detail: {
        ...input.detail,
        summary: input.summary,
        callerIp: caller.ip,
        callerAgent: caller.userAgent,
        // Null rather than "unknown": the reader should be able to tell "not
        // the kiosk" from "the kiosk, nobody recognised", and both from a name.
        callerPerson: identity.person,
        callerPersonScore: identity.score,
        callerPersonAgeSeconds: identity.ageSeconds,
        kioskSessionId: identity.sessionId,
      },
    });
  } catch {
    // emitDashboardEvent already swallows; this is belt and braces.
  }

  return identity;
}

/* ------------------------------------------------------------------ *
 * The digest
 * ------------------------------------------------------------------ */

let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Emit the digest for a session that has gone quiet, if one is due.
 *
 * Called on a timer after each touch, and lazily on read. The lazy path is what
 * makes a restart survivable: the timer dies with the process, but the session
 * record carries `lastTouchAt`, so the next read notices the session went quiet
 * while nobody was watching and emits the digest then rather than losing it.
 */
export async function flushDigest(): Promise<void> {
  try {
    const timings = readTimings();
    const now = Date.now();
    const state = await loadState();
    const due = digestDue(state, now, timings);
    if (!due) return;

    // Once per session at flush, never per action: a per-action event is
    // exactly the tap-by-tap stream the digest exists to replace.
    emitModuleEvent({
      id: "kiosk.session.digest",
      // `at` is when the visit ENDED, not when the notifier got round to it —
      // the envelope's contract, so a line delivered late still reads right.
      at: due.lastTouchAt,
      source: "server",
      data: {
        sessionId: due.sessionId,
        person: due.person,
        score: due.score,
        openedAt: due.openedAt,
        lastTouchAt: due.lastTouchAt,
        actions: due.actions,
        // Present on a continuation: the notifier edits that message rather
        // than posting a second one for the same visit.
        digestRef: due.digestRef,
        continuation: Boolean(due.digestSentAt),
      },
    });

    await saveState(markDigestSent(state, due.sessionId, due.digestRef, now));
  } catch {
    // A missed digest is not worth failing anything over.
  }
}

/**
 * Re-arm the quiet timer. Called on every touch, so the digest lands
 * `KIOSK_DIGEST_QUIET_SECONDS` after the LAST one rather than the first.
 */
export function scheduleDigestFlush(): void {
  const timings = readTimings();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushDigest();
  }, timings.digestQuietMs + 250);
  // Never hold the process open for a notification.
  flushTimer.unref?.();
}
