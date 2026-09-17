// SOLE state owner for the map package: the per-map tile-template caches that
// keep the radar and satellite sources from re-requesting unchanged tiles.
import type maplibregl from "maplibre-gl";
import {
  RADAR_REFRESH_INTERVAL_MS,
  RADAR_SOURCE_ID,
  SATELLITE_SOURCE_ID,
} from "./constants";
import { radarTileTemplate, satelliteTileTemplate } from "./css-theme-model";
import type { MutableRasterTileSource } from "./types";

const satelliteSourceTilesByMap = new WeakMap<maplibregl.Map, string>();
const radarSourceTilesByMap = new WeakMap<maplibregl.Map, string>();

export function updateSatelliteSource(map: maplibregl.Map) {
  const source = map.getSource(SATELLITE_SOURCE_ID) as MutableRasterTileSource | undefined;
  if (!source) {
    return;
  }

  const nextTiles = satelliteTileTemplate();
  if (satelliteSourceTilesByMap.get(map) === nextTiles) {
    return;
  }

  satelliteSourceTilesByMap.set(map, nextTiles);
  source.setTiles([nextTiles]);
  map.triggerRepaint();
}

export function updateRadarSource(map: maplibregl.Map, refreshBucket = Math.floor(Date.now() / RADAR_REFRESH_INTERVAL_MS)) {
  const source = map.getSource(RADAR_SOURCE_ID) as MutableRasterTileSource | undefined;
  if (!source) {
    return;
  }

  const nextTiles = radarTileTemplate(refreshBucket);
  if (radarSourceTilesByMap.get(map) === nextTiles) {
    return;
  }

  radarSourceTilesByMap.set(map, nextTiles);
  source.setTiles([nextTiles]);
  map.triggerRepaint();
}
