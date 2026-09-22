export function formatWatts(watts: number | null) {
  return watts === null ? "--" : `${Math.round(watts).toLocaleString()} W`;
}

export const GRAPH_WIDTH = 100;
export const GRAPH_HEIGHT = 40;
