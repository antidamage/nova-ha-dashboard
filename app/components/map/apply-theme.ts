import type maplibregl from "maplibre-gl";
import { MAP_COLOR_FALLBACKS, RADAR_LAYER_ID, SATELLITE_LAYER_ID } from "./constants";
import {
  buildingExtrusionOpacity,
  buildingFootprintOpacity,
  cssRgb,
  cssRgbWithOpacity,
  mapLabelSizeMultiplier,
  radarOpacityMultiplier,
  satelliteEnabled,
  waterOpacityMultiplier,
} from "./css-theme-model";
import {
  buildingExtrusionOpacityExpression,
  buildingFootprintOpacityExpression,
  buildingHeightColorExpression,
  landuseOpacityExpression,
  radarOpacityExpression,
  scaledLabelSize,
  streetLabelSizeExpression,
} from "./expression-model";
import { updateRadarSource, updateSatelliteSource } from "./store";

export function applyMapTheme(map: maplibregl.Map) {
  const baseColor = cssRgb("--cyber-map-base-rgb", MAP_COLOR_FALLBACKS.base);
  const buildingLowColor = cssRgb("--cyber-map-building-low-rgb", MAP_COLOR_FALLBACKS.buildingLow);
  const buildingHighColor = cssRgb("--cyber-map-building-high-rgb", MAP_COLOR_FALLBACKS.buildingHigh);
  const labelColor = cssRgb("--cyber-map-labels-rgb", MAP_COLOR_FALLBACKS.labels);
  const labelSizeMultiplier = mapLabelSizeMultiplier();
  const roadColor = "--cyber-map-roads-rgb";

  if (map.getLayer("background")) {
    map.setPaintProperty("background", "background-color", baseColor);
  }
  if (map.getLayer("water")) {
    map.setPaintProperty("water", "fill-color", cssRgb("--cyber-map-water-rgb", MAP_COLOR_FALLBACKS.water));
    map.setPaintProperty("water", "fill-opacity", waterOpacityMultiplier());
  }
  if (map.getLayer("landuse")) {
    map.setPaintProperty("landuse", "fill-color", cssRgb("--cyber-map-land-rgb", MAP_COLOR_FALLBACKS.land));
    map.setPaintProperty("landuse", "fill-opacity", landuseOpacityExpression());
  }

  if (map.getLayer("building-footprint")) {
    map.setPaintProperty("building-footprint", "fill-color", buildingHeightColorExpression(buildingLowColor, buildingHighColor));
    map.setPaintProperty("building-footprint", "fill-opacity", buildingFootprintOpacityExpression(buildingFootprintOpacity()));
  }

  if (map.getLayer("building-3d")) {
    map.setPaintProperty("building-3d", "fill-extrusion-color", buildingHeightColorExpression(buildingLowColor, buildingHighColor));
    map.setPaintProperty("building-3d", "fill-extrusion-opacity", buildingExtrusionOpacityExpression(buildingExtrusionOpacity()));
  }
  if (map.getLayer("road-major")) {
    map.setPaintProperty("road-major", "line-color", cssRgbWithOpacity(roadColor, MAP_COLOR_FALLBACKS.roads, 0.36));
  }
  if (map.getLayer("road-minor")) {
    map.setPaintProperty("road-minor", "line-color", cssRgbWithOpacity(roadColor, MAP_COLOR_FALLBACKS.roads, 0.18));
  }
  if (map.getLayer("label-street")) {
    map.setLayoutProperty("label-street", "text-size", streetLabelSizeExpression(labelSizeMultiplier));
    map.setPaintProperty("label-street", "text-color", labelColor);
  }
  if (map.getLayer("label-place")) {
    map.setLayoutProperty("label-place", "text-size", scaledLabelSize(11, labelSizeMultiplier));
    map.setPaintProperty("label-place", "text-color", labelColor);
  }
  if (map.getLayer(RADAR_LAYER_ID)) {
    map.setPaintProperty(RADAR_LAYER_ID, "raster-opacity", radarOpacityExpression(radarOpacityMultiplier()));
  }
  if (map.getLayer(SATELLITE_LAYER_ID)) {
    map.setLayoutProperty(SATELLITE_LAYER_ID, "visibility", satelliteEnabled() ? "visible" : "none");
  }
  updateSatelliteSource(map);
  updateRadarSource(map);
}
