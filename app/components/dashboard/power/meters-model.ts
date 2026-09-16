export function formatWatts(watts: number | null) {
  return watts === null ? "--" : `${Math.round(watts).toLocaleString()} W`;
}

export const GRAPH_WIDTH = 100;
export const GRAPH_HEIGHT = 40;
export const WASH_TIMELINE_MS = 12 * 60 * 60 * 1000;

/** Recent time gets room to breathe; older time deliberately compacts left. */
export function timelineX(at: number, now: number) {
  const age = Math.max(0, Math.min(1, (now - at) / WASH_TIMELINE_MS));
  return 100 * (1 - Math.sqrt(age));
}
