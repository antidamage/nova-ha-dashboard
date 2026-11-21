import type { DashboardConfig } from "../config-schema";
import type { HouseholdPerson } from "../config-schema/power";
import { isOutsideZone } from "../home-users/model";
import { buildDashboardState } from "../state";
import { applyPresenceActions, type PresenceActionResult } from "./apply";
import { reapplyNightCaps } from "./night-recheck";
import { decidePresenceActions, type PresenceEventKind } from "./rules-model";
import { clearPendingPresence, homeIdsOf, readPresence, setPresence } from "./store";

/**
 * The presence half of an arrival or departure (specs/home-users.md section 5):
 * read who was home, decide, record the new presence, act, then re-check the
 * night cap. Presence is recorded before acting so the lights that come on are
 * already capped for the person who just arrived.
 */

export type OccupancyResult = {
  changed: boolean;
  /** True when this call replayed a transition whose actions had not all landed. */
  replayed: boolean;
  home: string[];
  actions: PresenceActionResult[];
  nightRecheck: { ok: boolean; sent: number; error?: string };
};

/** True, false, or null when the sun cannot be read. */
async function sunIsUp(): Promise<boolean | null> {
  try {
    const state = (await buildDashboardState()).sun?.state;
    if (state === "above_horizon") return true;
    if (state === "below_horizon") return false;
    return null;
  } catch {
    return null;
  }
}

export async function runOccupancy(
  event: PresenceEventKind,
  member: HouseholdPerson,
  config: DashboardConfig,
): Promise<OccupancyResult> {
  const presence = await readPresence();
  const current = homeIdsOf(presence);
  const arriving = event === "arrival";
  const changed = arriving !== current.has(member.id);
  // A transition whose actions did not all land is replayed by a retry of the
  // same event, decided against who was home when it first happened, rather
  // than read as "already there" and left half done.
  const pending = presence.members[member.id]?.pending;
  const replaying = !changed && pending?.event === event;
  const homeBefore = replaying ? new Set(pending.homeBefore) : current;
  const actions = decidePresenceActions({
    event,
    member,
    people: config.dashboard.people,
    zoneSettings: config.dashboard.zones,
    homeBefore,
    sunUp: await sunIsUp(),
  });

  const after = changed
    ? homeIdsOf(await setPresence(member.id, arriving, actions.length ? { event, homeBefore: [...homeBefore] } : null))
    : current;
  const results = await applyPresenceActions(actions, config);
  if ((changed || replaying) && actions.length && results.every((result) => result.ok)) {
    await clearPendingPresence(member.id);
  }

  let nightRecheck: OccupancyResult["nightRecheck"] = { ok: true, sent: 0 };
  if (changed || replaying) {
    // Outside is switched, not dimmed, so it is never re-sent a brightness.
    const switchedOn = actions
      .flatMap((action) => (action.kind === "lights-on" ? action.zones : []))
      .filter((zoneId) => !isOutsideZone({ id: zoneId }));
    try {
      nightRecheck = { ok: true, sent: await reapplyNightCaps(switchedOn) };
    } catch (error) {
      nightRecheck = { ok: false, sent: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return { changed, replayed: replaying, home: [...after], actions: results, nightRecheck };
}
