import { THROTTLE_MAX_FAILURES, THROTTLE_WINDOW_MS } from "./constants";

// In-memory, per process: a restart clears it. Enough to make guessing a client
// secret over the network impractical without a store.
const failures = new Map<string, number[]>();

const MAX_TRACKED_IDS = 1000;

function recent(clientId: string, now: number) {
  const kept = (failures.get(clientId) ?? []).filter((at) => now - at < THROTTLE_WINDOW_MS);
  if (kept.length) {
    failures.set(clientId, kept);
  } else {
    failures.delete(clientId);
  }
  return kept;
}

/** Seconds until the client may try again, or 0 when it is not throttled. */
export function throttleRetryAfter(clientId: string, now = Date.now()): number {
  const kept = recent(clientId, now);
  if (kept.length < THROTTLE_MAX_FAILURES) {
    return 0;
  }
  return Math.max(1, Math.ceil((kept[0] + THROTTLE_WINDOW_MS - now) / 1000));
}

export function recordFailure(clientId: string, now = Date.now()) {
  const kept = recent(clientId, now);
  kept.push(now);
  failures.set(clientId, kept);
  if (failures.size > MAX_TRACKED_IDS) {
    // Oldest-tracked id first: a flood of made-up ids cannot grow memory without bound.
    failures.delete(failures.keys().next().value as string);
  }
}

export function clearFailures(clientId: string) {
  failures.delete(clientId);
}

export function resetThrottleForTests() {
  failures.clear();
}
