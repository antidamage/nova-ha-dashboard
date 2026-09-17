import type { StyleSpecification } from "maplibre-gl";
import {
  DEMO_MODE,
  MAJOR_ROAD_CLASSES,
  MAP_COLOR_FALLBACKS,
  RADAR_LAYER_ID,
  RADAR_SOURCE_ID,
  RAIN_RADAR_ATTRIBUTION_LABEL,
  SATELLITE_ATTRIBUTION,
  SATELLITE_LAYER_ID,
  SATELLITE_SOURCE_ID,
  TRANSPARENT_TILE,
} from "./constants";
import { cssRgb, cssRgbWithOpacity, waterOpacityMultiplier } from "./css-theme-model";
import {
  buildingExtrusionOpacityExpression,
  buildingFootprintOpacityExpression,
  buildingHeightColorExpression,
  landuseOpacityExpression,
  radarOpacityExpression,
  streetLabelSizeExpression,
} from "./expression-model";

export function createHomeMarkerElement() {
  const marker = document.createElement("div");
  marker.className = "nova-map-home-marker";
  marker.setAttribute("aria-label", "Home");
  marker.setAttribute("role", "img");
  return marker;
}
// Build the initial MapLibre style. Colours are read from the live
// `--cyber-map-*` CSS variables — which the inline theme bootstrap in
// app/layout.tsx sets synchronously (from the saved theme cookie) before this
// client component ever mounts — so the very first paint already uses the map
// theme. Previously these were hardcoded purple/grey defaults, so the map
// flashed the old purple defaults until applyMapTheme ran on load.
export function buildCyberpunkStyle(): StyleSpecification {
  return {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    openfreemap: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
    },
    [RADAR_SOURCE_ID]: {
      type: "raster",
      tiles: [DEMO_MODE ? TRANSPARENT_TILE : "/api/radar/{z}/{x}/{y}?mode=custom&low=255%2C242%2C0&high=106%2C255%2C0&v=0"],
      tileSize: 256,
      maxzoom: 7,
      attribution: RAIN_RADAR_ATTRIBUTION_LABEL,
    },
    [SATELLITE_SOURCE_ID]: {
      type: "raster",
      tiles: [DEMO_MODE ? TRANSPARENT_TILE : "/api/satellite/{z}/{x}/{y}"],
      tileSize: 256,
      maxzoom: 19,
      attribution: SATELLITE_ATTRIBUTION,
    },
  },
  light: {
    anchor: "viewport",
    color: "white",
    intensity: 0.45,
    position: [1.5, 90, 80],
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": cssRgb("--cyber-map-base-rgb", MAP_COLOR_FALLBACKS.base),
      },
    },
    {
      id: "landuse",
      type: "fill",
      source: "openfreemap",
      "source-layer": "landuse",
      paint: {
        "fill-color": cssRgb("--cyber-map-land-rgb", MAP_COLOR_FALLBACKS.land),
        "fill-opacity": landuseOpacityExpression(),
      },
    },
    {
      id: SATELLITE_LAYER_ID,
      type: "raster",
      source: SATELLITE_SOURCE_ID,
      paint: {
        "raster-opacity": 1,
        "raster-resampling": "linear",
      },
    },
    {
      id: "water",
      type: "fill",
      source: "openfreemap",
      "source-layer": "water",
      paint: {
        "fill-color": cssRgb("--cyber-map-water-rgb", MAP_COLOR_FALLBACKS.water),
        "fill-opacity": waterOpacityMultiplier(),
      },
    },
    {
      id: RADAR_LAYER_ID,
      type: "raster",
      source: RADAR_SOURCE_ID,
      paint: {
        "raster-fade-duration": 1200,
        "raster-opacity": radarOpacityExpression(1),
        "raster-resampling": "linear",
      },
    },
    {
      id: "road-minor",
      type: "line",
      source: "openfreemap",
      "source-layer": "transportation",
      filter: ["!", ["in", ["get", "class"], ["literal", MAJOR_ROAD_CLASSES]]],
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": cssRgbWithOpacity("--cyber-map-roads-rgb", MAP_COLOR_FALLBACKS.roads, 0.18),
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 16, 1.1],
      },
    },
    {
      id: "road-major",
      type: "line",
      source: "openfreemap",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", MAJOR_ROAD_CLASSES]],
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": cssRgbWithOpacity("--cyber-map-roads-rgb", MAP_COLOR_FALLBACKS.roads, 0.36),
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1, 16, 2.4],
      },
    },
    {
      id: "building-footprint",
      type: "fill",
      source: "openfreemap",
      "source-layer": "building",
      paint: {
        "fill-color": buildingHeightColorExpression(cssRgb("--cyber-map-building-low-rgb", MAP_COLOR_FALLBACKS.buildingLow), cssRgb("--cyber-map-building-high-rgb", MAP_COLOR_FALLBACKS.buildingHigh)),
        "fill-opacity": buildingFootprintOpacityExpression(),
      },
    },
    {
      id: "building-3d",
      type: "fill-extrusion",
      source: "openfreemap",
      "source-layer": "building",
      paint: {
        "fill-extrusion-color": buildingHeightColorExpression(cssRgb("--cyber-map-building-low-rgb", MAP_COLOR_FALLBACKS.buildingLow), cssRgb("--cyber-map-building-high-rgb", MAP_COLOR_FALLBACKS.buildingHigh)),
        "fill-extrusion-opacity": buildingExtrusionOpacityExpression(),
        "fill-extrusion-height": ["get", "render_height"],
        "fill-extrusion-base": ["get", "render_min_height"],
      },
    },
    {
      id: "label-street",
      type: "symbol",
      source: "openfreemap",
      "source-layer": "transportation_name",
      minzoom: 13,
      filter: ["all", ["has", "name"], ["!=", ["get", "class"], "path"]],
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 260,
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-keep-upright": true,
        "text-letter-spacing": 0.02,
        "text-pitch-alignment": "viewport",
        "text-rotation-alignment": "map",
        "text-size": streetLabelSizeExpression(),
      },
      paint: {
        "text-color": cssRgb("--cyber-map-labels-rgb", MAP_COLOR_FALLBACKS.labels),
        "text-halo-color": "#1a1a1a",
        "text-halo-width": 1.3,
        "text-opacity": 0.9,
      },
    },
    {
      id: "label-place",
      type: "symbol",
      source: "openfreemap",
      "source-layer": "place",
      filter: ["in", ["get", "class"], ["literal", ["city", "town", "village"]]],
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
      },
      paint: {
        "text-color": cssRgb("--cyber-map-labels-rgb", MAP_COLOR_FALLBACKS.labels),
        "text-halo-color": "#1a1a1a",
        "text-halo-width": 1.5,
      },
    },
  ],
  } as StyleSpecification;
}
