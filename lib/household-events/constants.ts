import path from "node:path";

export const HOUSEHOLD_EVENT_KINDS = [
  "ha_state",
  "occupancy",
  "device_health",
  "weather",
  "energy",
  "reminder",
  "calendar",
  "agent_task",
] as const;

export const DEFAULT_MAX_EVENTS = 20_000;
export const DEFAULT_PATH = path.join(process.cwd(), "data", "household-events.jsonl");

/**
 * Compaction rewrites the whole spool, so it has to be amortised. Compacting
 * the moment retention is exceeded means every append past the bound rewrites
 * the entire file — roughly 8 MB of disk writes per ~400 byte event. Letting
 * this fraction of the bound go stale on disk first turns that into one
 * rewrite per slack window.
 */
export const COMPACTION_SLACK_RATIO = 0.1;
