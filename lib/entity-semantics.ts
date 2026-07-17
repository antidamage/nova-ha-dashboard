import type { DashboardEntity } from "./types";

// Shared, isomorphic (server + client) semantics for interpreting Home
// Assistant entity state. Keeping a single source of truth here avoids the
// server (lib/ha) and the client (components/dashboard/shared) drifting apart
// on what "on" or "brightness" means.

const ON_STATES = ["on", "open", "opening", "playing", "heat", "cool", "heat_cool"];

export function isEntityOn(entity: Pick<DashboardEntity, "domain" | "state">): boolean {
  if (["unavailable", "unknown"].includes(entity.state)) {
    return false;
  }
  if (entity.domain === "climate") {
    return entity.state !== "off";
  }
  if (entity.domain === "sensor") {
    return false;
  }
  return ON_STATES.includes(entity.state);
}

/**
 * Average brightness (0-100) across the lights in a set that are currently on.
 * Returns 0 when nothing is on or no brightness is reported.
 */
export function zoneBrightnessPct(entities: DashboardEntity[]): number {
  const values = entities
    .filter((entity) => entity.domain === "light" && entity.state === "on")
    .map((entity) => Number(entity.attributes.brightness ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!values.length) {
    return 0;
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round((average / 255) * 100);
}
