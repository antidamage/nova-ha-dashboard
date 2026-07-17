"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { loadSharedClientConfig, readCachedClientConfig } from "./sharedConfigCache";

const DEFAULT_MAP_CENTER = {
  lat: -36.8509,
  lng: 174.7645,
};
const PAN_PX = 6;
const LEFT_MOUSE_BUTTON = 0;
const RIGHT_MOUSE_BUTTON = 2;
const LEFT_MOUSE_BUTTON_MASK = 1;
const RIGHT_MOUSE_BUTTON_MASK = 2;
const MIN_CENTER_ROTATE_SCALE = 0.25;
const LOW_BUILDING_HEIGHT_METERS = 3;
const HIGH_BUILDING_HEIGHT_METERS = 15;
const BUILDING_EXTRUSION_OPACITY = 0.66;
const BUILDING_FOOTPRINT_OPACITY = 0.2;
const WHEEL_ZOOM_RATE = 1 / 900;
const WHEEL_ZOOM_EASE_SECONDS = 0.42;
const WHEEL_ZOOM_RENDER_THRESHOLD = 0.0006;
const WHEEL_ZOOM_MAX_DELTA_PER_SECOND = 1.25;
const RADAR_SOURCE_ID = "rain-radar";
const RADAR_LAYER_ID = "rain-radar-layer";
const SATELLITE_SOURCE_ID = "satellite-imagery";
const SATELLITE_LAYER_ID = "satellite-ground";
const SATELLITE_ATTRIBUTION =
  "Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community";
const satelliteSourceTilesByMap = new WeakMap<maplibregl.Map, string>();
const RADAR_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const RADAR_SOURCE_POLL_MS = 60 * 1000;
const MAP_COLOR_FALLBACKS = {
  base: "26 26 26",
  buildingHigh: "115 0 255",
  buildingLow: "72 0 161",
  labels: "168 168 168",
  land: "30 32 32",
  radarHigh: "106 255 0",
  radarLow: "255 242 0",
  roads: "177 154 223",
  water: "140 0 255",
};
const MAJOR_ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary"];
const RAIN_RADAR_ATTRIBUTION_LABEL = "Radar: RainViewer / MetService";
const RAIN_RADAR_ATTRIBUTION_URL = "https://www.rainviewer.com/";
const RADAR_PALETTE_MODE_FALLBACK = "custom";
const DEMO_MODE = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";
const TRANSPARENT_TILE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const radarSourceTilesByMap = new WeakMap<maplibregl.Map, string>();

type DragRotateResultShim = {
  bearingDelta?: number;
} & Record<string, unknown>;

type MutableRasterTileSource = {
  setTiles: (tiles: string[]) => void;
};

type MouseRotateHandlerShim = {
  _moveFunction?: (lastPoint: unknown, currentPoint: unknown) => DragRotateResultShim | undefined;
};

type DragRotateHandlerShim = {
  _mouseRotate?: MouseRotateHandlerShim;
};

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function parseMapCenter(value?: string): [number, number] {
  const [latText, lngText] = (value ?? "").split(",").map((part) => part.trim());
  const lat = Number(latText);
  const lng = Number(lngText);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return [DEFAULT_MAP_CENTER.lng, DEFAULT_MAP_CENTER.lat];
  }

  return [lng, lat];
}

function configuredMapCenterFromPayload(payload: unknown): [number, number] | null {
  const config = payload as { mapWeather?: { center?: { lat?: unknown; lng?: unknown } } } | null;
  const lat = Number(config?.mapWeather?.center?.lat);
  const lng = Number(config?.mapWeather?.center?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  return [lng, lat];
}

function readCachedConfiguredMapCenter() {
  return configuredMapCenterFromPayload(readCachedClientConfig());
}

async function fetchConfiguredMapCenter(): Promise<[number, number] | null> {
  try {
    return configuredMapCenterFromPayload(await loadSharedClientConfig());
  } catch {
    return null;
  }
}

function readCssRgb(variableName: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim() || fallback;
}

function readCssNumber(variableName: string, fallback: number) {
  const parsed = Number(getComputedStyle(document.documentElement).getPropertyValue(variableName).trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cssRgb(variableName: string, fallback: string) {
  return `rgb(${readCssRgb(variableName, fallback)})`;
}

function cssRgbWithOpacity(variableName: string, fallback: string, opacity: number) {
  return `rgb(${readCssRgb(variableName, fallback)} / ${opacity})`;
}

function cssRgbCsv(variableName: string, fallback: string) {
  return readCssRgb(variableName, fallback).replace(/\s+/g, ",");
}

function buildingHeightColorExpression(lowColor: string, highColor: string) {
  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["get", "render_height"], LOW_BUILDING_HEIGHT_METERS],
    LOW_BUILDING_HEIGHT_METERS,
    lowColor,
    HIGH_BUILDING_HEIGHT_METERS,
    highColor,
  ];
}

function buildingExtrusionOpacityExpression(baseOpacity = BUILDING_EXTRUSION_OPACITY) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    8.6,
    0,
    9.4,
    baseOpacity * 0.01,
    10.2,
    baseOpacity * 0.03,
    11,
    baseOpacity * 0.07,
    11.8,
    baseOpacity * 0.14,
    12.6,
    baseOpacity * 0.24,
    13.4,
    baseOpacity * 0.4,
    14.2,
    baseOpacity * 0.68,
    14.7,
    baseOpacity * 0.86,
    15,
    baseOpacity,
  ] as const;
}

function buildingFootprintOpacityExpression(baseOpacity = BUILDING_FOOTPRINT_OPACITY) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    8.4,
    0,
    9.2,
    baseOpacity * 0.08,
    10.2,
    baseOpacity * 0.18,
    11.2,
    baseOpacity * 0.34,
    12.2,
    baseOpacity * 0.56,
    13.2,
    baseOpacity * 0.82,
    14.2,
    baseOpacity,
    14.9,
    baseOpacity * 0.78,
    15.5,
    baseOpacity * 0.42,
    16,
    baseOpacity * 0.14,
    16.4,
    0,
  ] as const;
}

function landuseOpacityExpression(baseOpacity = 0.6) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    8.4,
    0,
    9.2,
    baseOpacity * 0.03,
    10.2,
    baseOpacity * 0.08,
    11.2,
    baseOpacity * 0.18,
    12.2,
    baseOpacity * 0.32,
    13.2,
    baseOpacity * 0.48,
    14,
    baseOpacity,
    14.8,
    baseOpacity * 0.78,
    15.4,
    baseOpacity * 0.42,
    15.9,
    baseOpacity * 0.12,
    16.3,
    0,
  ] as const;
}

function dampValue(current: number, target: number, deltaSeconds: number, easeSeconds: number) {
  if (easeSeconds <= 0) {
    return target;
  }

  const amount = 1 - Math.exp(-deltaSeconds / easeSeconds);
  return current + (target - current) * amount;
}

function clampDelta(current: number, target: number, maxDelta: number) {
  if (maxDelta <= 0) {
    return current;
  }

  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) {
    return target;
  }

  return current + Math.sign(delta) * maxDelta;
}

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeWheelDelta(deltaY: number, deltaMode: number, shiftKey: boolean) {
  const delta = deltaMode === WheelEvent.DOM_DELTA_LINE ? deltaY * 40 : deltaY;
  return shiftKey ? delta / 4 : delta;
}

function radarPaletteMode() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--cyber-map-radar-mode").trim().toLowerCase();
  return value === "spectrum" ? "spectrum" : RADAR_PALETTE_MODE_FALLBACK;
}

function radarTileTemplate(refreshBucket = Math.floor(Date.now() / RADAR_REFRESH_INTERVAL_MS)) {
  if (DEMO_MODE) {
    return TRANSPARENT_TILE;
  }
  const mode = radarPaletteMode();
  const low = encodeURIComponent(cssRgbCsv("--cyber-map-radar-low-rgb", MAP_COLOR_FALLBACKS.radarLow));
  const high = encodeURIComponent(cssRgbCsv("--cyber-map-radar-high-rgb", MAP_COLOR_FALLBACKS.radarHigh));
  return `/api/radar/{z}/{x}/{y}?mode=${mode}&low=${low}&high=${high}&v=${refreshBucket}`;
}

function radarOpacityMultiplier() {
  return Math.max(0, Math.min(1, readCssNumber("--cyber-map-radar-opacity", 87) / 100));
}

function satelliteEnabled() {
  return readCssNumber("--cyber-map-satellite", 1) >= 0.5;
}

function mapLabelSizeMultiplier() {
  return Math.max(0.5, Math.min(2, readCssNumber("--cyber-map-label-size", 150) / 100));
}

function buildingExtrusionOpacity() {
  return Math.max(0, Math.min(1, readCssNumber("--cyber-map-building-opacity", BUILDING_EXTRUSION_OPACITY * 100) / 100));
}

function buildingFootprintOpacity() {
  return buildingExtrusionOpacity() * (BUILDING_FOOTPRINT_OPACITY / BUILDING_EXTRUSION_OPACITY);
}

function waterOpacityMultiplier() {
  if (readCssNumber("--cyber-map-water-enabled", 1) < 0.5) {
    return 0;
  }

  return Math.max(0, Math.min(1, readCssNumber("--cyber-map-water-opacity", 10) / 100));
}

function scaledLabelSize(value: number, multiplier: number) {
  return Math.round(value * multiplier * 100) / 100;
}

function streetLabelSizeExpression(multiplier = 1) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    13,
    scaledLabelSize(9, multiplier),
    16,
    scaledLabelSize(12, multiplier),
  ] as const;
}

function satelliteTileTemplate() {
  if (DEMO_MODE) {
    return TRANSPARENT_TILE;
  }
  const base = encodeURIComponent(cssRgbCsv("--cyber-map-base-rgb", MAP_COLOR_FALLBACKS.base));
  return `/api/satellite/{z}/{x}/{y}?base=${base}`;
}

function updateSatelliteSource(map: maplibregl.Map) {
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

function radarOpacityExpression(opacityMultiplier: number) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    9,
    0.88 * opacityMultiplier,
    9.8,
    0.8 * opacityMultiplier,
    10.6,
    0.66 * opacityMultiplier,
    11.4,
    0.5 * opacityMultiplier,
    12.1,
    0.34 * opacityMultiplier,
    12.8,
    0.2 * opacityMultiplier,
    13.4,
    0.12 * opacityMultiplier,
    14,
    0.06 * opacityMultiplier,
    14.6,
    0.02 * opacityMultiplier,
    15.2,
    0,
  ] as const;
}

function updateRadarSource(map: maplibregl.Map, refreshBucket = Math.floor(Date.now() / RADAR_REFRESH_INTERVAL_MS)) {
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

function frameDeltaSeconds(currentTime: number, previousTime: number | null) {
  if (previousTime === null) {
    return 1 / 60;
  }

  return Math.max(0, Math.min(0.12, (currentTime - previousTime) / 1000));
}

function isPanKey(key: string) {
  return key === "w" || key === "a" || key === "s" || key === "d";
}

function getCameraRelativePanOffset(keys: Set<string>): [number, number] {
  let dx = 0;
  let dy = 0;

  if (keys.has("w")) {
    dy -= PAN_PX;
  }
  if (keys.has("s")) {
    dy += PAN_PX;
  }
  if (keys.has("a")) {
    dx -= PAN_PX;
  }
  if (keys.has("d")) {
    dx += PAN_PX;
  }

  return [dx, dy];
}

function getCenterRotationScale(rect: DOMRect, clientX: number, clientY: number) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const maxDistance = Math.hypot(rect.width / 2, rect.height / 2) || 1;
  const distanceFromCenter = Math.hypot(clientX - centerX, clientY - centerY);
  const distanceRatio = Math.min(distanceFromCenter / maxDistance, 1);

  return MIN_CENTER_ROTATE_SCALE + distanceRatio * (1 - MIN_CENTER_ROTATE_SCALE);
}

function createHomeMarkerElement() {
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
function buildCyberpunkStyle(): StyleSpecification {
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

function applyMapTheme(map: maplibregl.Map) {
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

export function MapPanel({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const isLeftMouseHeld = useRef(false);
  const isRightMouseHeld = useRef(false);
  const centerRotationScale = useRef(1);
  const heldKeys = useRef(new Set<string>());
  const animFrameRef = useRef<number>(0);
  const wheelZoomTarget = useRef<number | null>(null);
  const wheelZoomAround = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const mapContainer = containerRef.current;
    const homeCenter = parseMapCenter(process.env.NEXT_PUBLIC_MAP_CENTER);
    const map = new maplibregl.Map({
      bearing: -17,
      canvasContextAttributes: {
        antialias: true,
      },
      centerClampedToGround: false,
      center: homeCenter,
      container: containerRef.current,
      pitch: 45,
      style: buildCyberpunkStyle(),
      zoom: 15,
    });

    mapRef.current = map;
    map.setCenterClampedToGround(false);
    map.scrollZoom.disable();
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    const homeMarker = new maplibregl.Marker({
      anchor: "center",
      element: createHomeMarkerElement(),
      pitchAlignment: "viewport",
      rotationAlignment: "viewport",
    })
      .setLngLat(homeCenter)
      .addTo(map);

    const applyConfiguredCenter = (configuredCenter: [number, number] | null) => {
      if (!configuredCenter || mapRef.current !== map) {
        return;
      }
      map.jumpTo({ center: configuredCenter });
      homeMarker.setLngLat(configuredCenter);
    };

    applyConfiguredCenter(readCachedConfiguredMapCenter());
    void fetchConfiguredMapCenter().then((configuredCenter) => {
      applyConfiguredCenter(configuredCenter);
    });

    const mouseRotate = (map.dragRotate as unknown as DragRotateHandlerShim)._mouseRotate;
    const originalRotateMove = mouseRotate?._moveFunction;
    if (mouseRotate && originalRotateMove) {
      mouseRotate._moveFunction = (lastPoint, currentPoint) => {
        const result = originalRotateMove(lastPoint, currentPoint);

        if (!result?.bearingDelta || !isRightMouseHeld.current) {
          return result;
        }

        return {
          ...result,
          bearingDelta: result.bearingDelta * centerRotationScale.current,
        };
      };
    }

    let previousFrameTime: number | null = null;
    const radarSourceRefreshTimer = window.setInterval(() => updateRadarSource(map), RADAR_SOURCE_POLL_MS);

    const handleLoad = () => {
      map.jumpTo({
        bearing: -17,
        center: homeCenter,
        pitch: 45,
        zoom: 15,
      });
      map.setCenterClampedToGround(false);
      wheelZoomTarget.current = map.getZoom();
      wheelZoomAround.current = null;
      applyMapTheme(map);
    };
    const handleAccentChange = () => applyMapTheme(map);
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if ((isLeftMouseHeld.current || isRightMouseHeld.current) && isPanKey(key)) {
        event.preventDefault();
      }

      heldKeys.current.add(key);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      heldKeys.current.delete(event.key.toLowerCase());
    };
    const handleWindowBlur = () => {
      isLeftMouseHeld.current = false;
      isRightMouseHeld.current = false;
      heldKeys.current.clear();
    };
    const handleWindowMouseUp = (event: MouseEvent) => {
      if (event.button === LEFT_MOUSE_BUTTON) {
        isLeftMouseHeld.current = false;
      }
      if (event.button === RIGHT_MOUSE_BUTTON) {
        isRightMouseHeld.current = false;
      }
      if (event.buttons === 0) {
        isLeftMouseHeld.current = false;
        isRightMouseHeld.current = false;
      }
    };
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = normalizeWheelDelta(event.deltaY, event.deltaMode, event.shiftKey);
      if (!delta) {
        return;
      }

      const rect = mapContainer.getBoundingClientRect();
      const point: [number, number] = [event.clientX - rect.left, event.clientY - rect.top];
      const anchor = map.unproject(point);
      const startZoom = wheelZoomTarget.current ?? map.getZoom();
      const targetZoom = clampValue(startZoom - delta * WHEEL_ZOOM_RATE, map.getMinZoom(), map.getMaxZoom());

      wheelZoomTarget.current = targetZoom;
      wheelZoomAround.current = [anchor.lng, anchor.lat];
    };
    const frameLoop = (frameTime: number) => {
      const deltaSeconds = frameDeltaSeconds(frameTime, previousFrameTime);
      previousFrameTime = frameTime;

      const targetWheelZoom = wheelZoomTarget.current;
      if (typeof targetWheelZoom === "number") {
        const currentZoom = map.getZoom();
        const nextZoom = clampDelta(
          currentZoom,
          dampValue(currentZoom, targetWheelZoom, deltaSeconds, WHEEL_ZOOM_EASE_SECONDS),
          WHEEL_ZOOM_MAX_DELTA_PER_SECOND * deltaSeconds,
        );

        if (Math.abs(nextZoom - currentZoom) > WHEEL_ZOOM_RENDER_THRESHOLD) {
          map.easeTo({
            around: wheelZoomAround.current ?? map.getCenter(),
            animate: false,
            duration: 0,
            essential: true,
            zoom: nextZoom,
          });
        } else {
          wheelZoomTarget.current = null;
          wheelZoomAround.current = null;
        }
      }

      if (isLeftMouseHeld.current || isRightMouseHeld.current) {
        const [dx, dy] = getCameraRelativePanOffset(heldKeys.current);

        if (dx || dy) {
          map.panBy([dx, dy], { duration: 0 });
        }
      }

      animFrameRef.current = window.requestAnimationFrame(frameLoop);
    };

    map.on("load", handleLoad);
    window.addEventListener("nova-accent-change", handleAccentChange);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("mouseup", handleWindowMouseUp);
    mapContainer.addEventListener("wheel", handleWheel, { passive: false });
    animFrameRef.current = window.requestAnimationFrame(frameLoop);

    return () => {
      window.cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("nova-accent-change", handleAccentChange);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("mouseup", handleWindowMouseUp);
      mapContainer.removeEventListener("wheel", handleWheel);
      window.clearInterval(radarSourceRefreshTimer);
      if (mouseRotate && originalRotateMove) {
        mouseRotate._moveFunction = originalRotateMove;
      }
      map.off("load", handleLoad);
      homeMarker.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Keep the map no taller than the viewport space left below its top edge.
  // The panel's `aspect-ratio` grows the box with its width, so on a wide
  // window the map would otherwise run past the bottom of the screen and force
  // scrolling. We cap the bordered section (our grandparent), which the map
  // fills via h-full; MapLibre re-fits its canvas to the new size.
  useEffect(() => {
    const section = containerRef.current?.parentElement?.parentElement;
    if (!(section instanceof HTMLElement)) {
      return;
    }
    const BOTTOM_GAP_PX = 20;
    const fitToViewport = () => {
      const top = section.getBoundingClientRect().top;
      const available = window.innerHeight - top - BOTTOM_GAP_PX;
      section.style.maxHeight = available > 0 ? `${available}px` : "";
      mapRef.current?.resize();
    };
    fitToViewport();
    window.addEventListener("resize", fitToViewport);
    return () => {
      window.removeEventListener("resize", fitToViewport);
      section.style.maxHeight = "";
    };
  }, []);

  return (
    <div
      className={classNames("relative overflow-hidden touch-manipulation", className)}
      onContextMenu={(event) => event.preventDefault()}
      onMouseDownCapture={(event) => {
        if (event.button === LEFT_MOUSE_BUTTON) {
          isLeftMouseHeld.current = true;
        }
        if (event.button === RIGHT_MOUSE_BUTTON) {
          isRightMouseHeld.current = true;
          centerRotationScale.current = getCenterRotationScale(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
        }
        wheelZoomTarget.current = null;
        wheelZoomAround.current = null;
      }}
      onMouseLeave={(event) => {
        if (event.buttons === 0) {
          isLeftMouseHeld.current = false;
          isRightMouseHeld.current = false;
        }
      }}
      onMouseMove={(event) => {
        isLeftMouseHeld.current = (event.buttons & LEFT_MOUSE_BUTTON_MASK) === LEFT_MOUSE_BUTTON_MASK;
        isRightMouseHeld.current = (event.buttons & RIGHT_MOUSE_BUTTON_MASK) === RIGHT_MOUSE_BUTTON_MASK;
      }}
      onMouseUp={(event) => {
        if (event.button === LEFT_MOUSE_BUTTON) {
          isLeftMouseHeld.current = false;
        }
        if (event.button === RIGHT_MOUSE_BUTTON) {
          isRightMouseHeld.current = false;
        }
      }}
    >
      <div ref={containerRef} className="h-full w-full" />
      <div className="nova-map-attribution">
        <a href={RAIN_RADAR_ATTRIBUTION_URL} target="_blank" rel="noreferrer">
          {RAIN_RADAR_ATTRIBUTION_LABEL}
        </a>
      </div>
    </div>
  );
}
