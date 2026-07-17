"use client";

// A SINGLE shared EventSource for `/api/events`, shared across every consumer on
// the page.
//
// Why this exists: the dashboard mounts several independent SSE consumers — the
// build-reloader (useBuildReload), the dashboard state hook (useDashboardState)
// and the reminders overlay (TasksPanel) — and each one used to open its OWN
// `new EventSource("/api/events")`. Over plain HTTP/1.1 (what the Next server on
// Nova speaks on the LAN) a browser allows only ~6 concurrent connections per
// origin, and every SSE stream holds one open permanently. Three of them, plus
// the camera's continuous HLS segment fetches and the SystemActivityBlocker's
// /api/update health poll, was enough to starve the connection pool: the health
// poll got queued, couldn't finish inside its abort window, and the blocker read
// that as "Nova is offline" — even on Nova's own screen.
//
// Collapsing every consumer onto one connection frees those slots. The module
// ref-counts subscribers: the first subscriber opens the stream, the last one to
// leave closes it. One real listener per event name is registered on the shared
// EventSource and fanned out to all subscriber handlers for that name.
//
// Bonus: one connection per tab means one server-assigned `client-id`, so the
// command echo-suppression (POLLING COOLDOWN CONTRACT) attributes commands and
// `state` pushes to the same stream by construction.

type Handler = (event: MessageEvent) => void;

let source: EventSource | null = null;
let refCount = 0;
const handlersByType = new Map<string, Set<Handler>>();
const fanoutsByType = new Map<string, EventListener>();

// The browser auto-reconnects an errored EventSource only while it is in
// CONNECTING; a stream that reaches CLOSED (e.g. a proxy answering 200 with
// the wrong content type) stays dead forever unless we rebuild it. Watchdog:
// on a CLOSED error, tear the stream down and reopen with capped backoff for
// as long as anyone is still subscribed.
const REOPEN_DELAY_MIN_MS = 2_000;
const REOPEN_DELAY_MAX_MS = 30_000;
let reopenTimer: ReturnType<typeof setTimeout> | null = null;
let reopenDelayMs = REOPEN_DELAY_MIN_MS;

// A CLOSED stream is only half the failure surface: a half-open TCP connection
// (server restarted, box slept, socket dropped without a FIN reaching us) keeps
// readyState at OPEN forever, fires no error, and simply never delivers another
// event. The server's ": keep-alive" comment is invisible to JS, so it also
// pushes a named "heartbeat" event every ~15s. If nothing at all arrives for
// several heartbeats the stream is dead regardless of what readyState claims —
// tear it down and rebuild. (2026-07-11 kiosk soft outage: page wedged for 70+
// minutes on a silently dead stream while the server was healthy.)
const LIVENESS_STALL_MS = 50_000;
const LIVENESS_CHECK_INTERVAL_MS = 10_000;
let livenessTimer: ReturnType<typeof setInterval> | null = null;
let lastEventAt = 0;

function markEventActivity(): void {
  lastEventAt = Date.now();
}

function startLivenessWatchdog(): void {
  if (livenessTimer !== null) {
    return;
  }
  livenessTimer = setInterval(() => {
    if (!source || source.readyState !== EventSource.OPEN) {
      return;
    }
    if (Date.now() - lastEventAt <= LIVENESS_STALL_MS) {
      return;
    }
    // Silent stream: rebuild immediately (fresh connection, minimal delay).
    // If the server is genuinely down the reopened stream will error into the
    // CLOSED path above and back off normally from there.
    reopenDelayMs = REOPEN_DELAY_MIN_MS;
    closeSource();
    scheduleReopen();
  }, LIVENESS_CHECK_INTERVAL_MS);
}

function stopLivenessWatchdog(): void {
  if (livenessTimer !== null) {
    clearInterval(livenessTimer);
    livenessTimer = null;
  }
}

function scheduleReopen(): void {
  if (reopenTimer !== null || refCount <= 0) {
    return;
  }
  reopenTimer = setTimeout(() => {
    reopenTimer = null;
    if (refCount > 0 && !source) {
      openSource();
    }
  }, reopenDelayMs);
  reopenDelayMs = Math.min(REOPEN_DELAY_MAX_MS, reopenDelayMs * 2);
}

function ensureFanout(type: string): void {
  if (fanoutsByType.has(type)) {
    return;
  }
  const fanout: EventListener = (event) => {
    markEventActivity();
    const handlers = handlersByType.get(type);
    if (!handlers) {
      return;
    }
    // Copy so a handler that unsubscribes mid-dispatch can't mutate the set
    // we're iterating.
    for (const handler of Array.from(handlers)) {
      handler(event as MessageEvent);
    }
  };
  fanoutsByType.set(type, fanout);
  source?.addEventListener(type, fanout);
}

function openSource(): void {
  if (source || typeof EventSource === "undefined") {
    return;
  }
  source = new EventSource("/api/events");
  markEventActivity();
  source.addEventListener("open", () => {
    reopenDelayMs = REOPEN_DELAY_MIN_MS;
    markEventActivity();
  });
  // Not part of the consumer fanout: the heartbeat exists purely so the
  // liveness watchdog can tell a quiet-but-alive stream from a dead one.
  source.addEventListener("heartbeat", markEventActivity);
  startLivenessWatchdog();
  source.addEventListener("error", () => {
    if (source && source.readyState === EventSource.CLOSED) {
      closeSource();
      scheduleReopen();
    }
  });
  for (const [type, fanout] of fanoutsByType) {
    source.addEventListener(type, fanout);
  }
}

function closeSource(): void {
  if (!source) {
    return;
  }
  for (const [type, fanout] of fanoutsByType) {
    source.removeEventListener(type, fanout);
  }
  source.close();
  source = null;
}

/**
 * Subscribe to one or more named SSE events on the shared `/api/events` stream.
 * `handlers` maps an event name (custom names like "state"/"tasks", or the
 * native "open"/"error") to a callback. Returns an unsubscribe function that
 * detaches the handlers and, when the last subscriber leaves, closes the stream.
 */
export function subscribeToDashboardEvents(
  handlers: Record<string, Handler>,
): () => void {
  if (typeof EventSource === "undefined") {
    return () => {};
  }

  const entries = Object.entries(handlers);
  refCount += 1;
  openSource();

  for (const [type, handler] of entries) {
    ensureFanout(type);
    let set = handlersByType.get(type);
    if (!set) {
      set = new Set();
      handlersByType.set(type, set);
    }
    set.add(handler);
    // A consumer that subscribes after the stream has already opened would miss
    // the one-shot native "open"; replay it so connection-state handlers still
    // initialise.
    if (type === "open" && source?.readyState === EventSource.OPEN) {
      handler(new MessageEvent("open"));
    }
  }

  return () => {
    for (const [type, handler] of entries) {
      handlersByType.get(type)?.delete(handler);
    }
    refCount -= 1;
    if (refCount <= 0) {
      refCount = 0;
      if (reopenTimer !== null) {
        clearTimeout(reopenTimer);
        reopenTimer = null;
      }
      stopLivenessWatchdog();
      closeSource();
    }
  };
}
