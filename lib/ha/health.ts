import type { HaHealth, HaState } from "../types";

/**
 * Guard against the "everything unresponsive at once" soft outage.
 *
 * A dashboard tile only ever renders "unavailable" because the current snapshot
 * literally carries `state: "unavailable"`. Home Assistant returns *every* entity
 * as unavailable in one `/api/states` response whenever it is momentarily
 * unhealthy — mid-restart, reloading an integration, bouncing the recorder, or
 * with its event loop briefly blocked. Copied verbatim, that flips every tile
 * (including the HA-derived host/router tile) to dead at once, then recovers on
 * the next poll: a scary, user-visible, self-healing outage.
 *
 * `reconcileHaStates` sits between the raw HA snapshot and all downstream
 * projection. When it detects a *mass* unavailability event (as opposed to one
 * or a few genuinely-offline devices) it holds the last-known-good states for a
 * bounded window and flags the snapshot `degraded`, so the UI can show a small
 * "reconnecting" chip instead of a wall of red. A single device dropping offline
 * is never "mass", so normal device-availability behaviour is unchanged.
 */

// Only entities the user actively controls count toward the "mass" judgement.
// Sensors legitimately flap unavailable on their own and must not, by
// themselves, make us hold the whole snapshot.
const CONTROL_DOMAINS = new Set(["light", "switch", "climate", "fan", "cover"]);

// Need at least this many known-healthy control entities before a fraction is
// meaningful — a home with 3 lights should not trip the heuristic.
const MASS_MIN_KNOWN = 5;

// Fraction of known-healthy control entities that must go dead at once to treat
// the snapshot as a transient HA outage rather than reality.
const MASS_UNAVAILABLE_FRACTION = 0.6;

// Never hold longer than this. Past it we accept reality so a genuinely removed
// or long-down device eventually reflects instead of being masked forever.
const MAX_HOLD_MS = 90_000;

type HealthStore = {
  lastHealthyStates: Map<string, HaState>;
  degradedSince: number | null;
};

const globalWithHaHealth = globalThis as typeof globalThis & {
  __novaHaHealth?: HealthStore;
};

const store =
  globalWithHaHealth.__novaHaHealth ??
  (globalWithHaHealth.__novaHaHealth = {
    lastHealthyStates: new Map<string, HaState>(),
    degradedSince: null,
  });

function isDead(state: string) {
  return state === "unavailable" || state === "unknown";
}

function isControlEntity(entityId: string) {
  const domain = entityId.split(".", 1)[0];
  return CONTROL_DOMAINS.has(domain);
}

/** For tests / process-lifecycle resets. */
export function resetHaHealthMemory() {
  store.lastHealthyStates.clear();
  store.degradedSince = null;
}

/**
 * Given the raw HA `/api/states` snapshot, return the states the dashboard
 * should actually render plus a health verdict. During a mass-unavailability
 * blip the returned states retain the last-known-good values for the affected
 * entities and `health.status` is `"degraded"`.
 */
export function reconcileHaStates(fresh: HaState[]): { states: HaState[]; health: HaHealth } {
  const now = Date.now();
  const known = store.lastHealthyStates;
  const freshById = new Map(fresh.map((state) => [state.entity_id, state]));

  // Count known-healthy control entities that just went dead (or vanished).
  let knownControl = 0;
  let deadControl = 0;
  for (const [entityId, previous] of known) {
    if (!isControlEntity(entityId) || isDead(previous.state)) {
      continue;
    }
    knownControl += 1;
    const current = freshById.get(entityId);
    if (!current || isDead(current.state)) {
      deadControl += 1;
    }
  }

  const emptyish = known.size >= MASS_MIN_KNOWN && fresh.length < known.size * 0.5;
  const massUnavailable =
    emptyish ||
    (knownControl >= MASS_MIN_KNOWN && deadControl / knownControl >= MASS_UNAVAILABLE_FRACTION);

  if (!massUnavailable) {
    // Healthy (or at most a few devices offline): trust HA. Refresh memory for
    // every entity that currently has a real value.
    for (const state of fresh) {
      if (!isDead(state.state)) {
        known.set(state.entity_id, state);
      }
    }
    store.degradedSince = null;
    return { states: fresh, health: { status: "ok", degradedSince: null, heldEntityCount: 0 } };
  }

  // Transient mass outage. Start or continue the hold window.
  if (store.degradedSince == null) {
    store.degradedSince = now;
  }
  const degradedSinceIso = new Date(store.degradedSince).toISOString();

  // Held too long — stop pretending and surface the real snapshot.
  if (now - store.degradedSince > MAX_HOLD_MS) {
    return {
      states: fresh,
      health: {
        status: "degraded",
        degradedSince: degradedSinceIso,
        heldEntityCount: 0,
        reason: "hold-expired",
      },
    };
  }

  // Substitute last-known-good for entities that just went dead, and re-add
  // known entities HA dropped entirely from this snapshot.
  let held = 0;
  const merged = fresh.map((state) => {
    if (isDead(state.state)) {
      const previous = known.get(state.entity_id);
      if (previous && !isDead(previous.state)) {
        held += 1;
        return { ...previous };
      }
    }
    return state;
  });
  for (const [entityId, previous] of known) {
    if (!freshById.has(entityId) && !isDead(previous.state)) {
      merged.push({ ...previous });
      held += 1;
    }
  }

  return {
    states: merged,
    health: {
      status: "degraded",
      degradedSince: degradedSinceIso,
      heldEntityCount: held,
      reason: emptyish ? "empty-snapshot" : "mass-unavailable",
    },
  };
}
