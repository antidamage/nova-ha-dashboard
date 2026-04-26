"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

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
const BUILDING_EXTRUSION_OPACITY = 0.38;
const BUILDING_FOOTPRINT_OPACITY = 0.2;
const WHEEL_ZOOM_RATE = 1 / 900;
const WHEEL_ZOOM_EASE_SECONDS = 0.42;
const WHEEL_ZOOM_RENDER_THRESHOLD = 0.0006;
const WHEEL_ZOOM_MAX_DELTA_PER_SECOND = 1.25;
const RADAR_SOURCE_ID = "rain-radar";
const RADAR_LAYER_ID = "rain-radar-layer";
const RADAR_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const RADAR_SOURCE_POLL_MS = 60 * 1000;
const MAP_COLOR_FALLBACKS = {
  base: "37 39 40",
  buildingHigh: "255 255 255",
  buildingLow: "215 255 50",
  labels: "215 255 50",
  land: "30 32 32",
  radarHigh: "255 255 255",
  radarLow: "40 243 255",
  roads: "215 255 50",
  water: "191 232 255",
};
const MAJOR_ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary"];
const RAIN_RADAR_ATTRIBUTION_LABEL = "Radar: RainViewer / MetService";
const RAIN_RADAR_ATTRIBUTION_URL = "https://www.rainviewer.com/";
const RADAR_PALETTE_MODE_FALLBACK = "spectrum";
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
  return value === "custom" ? "custom" : RADAR_PALETTE_MODE_FALLBACK;
}

function radarTileTemplate(refreshBucket = Math.floor(Date.now() / RADAR_REFRESH_INTERVAL_MS)) {
  const mode = radarPaletteMode();
  const low = encodeURIComponent(cssRgbCsv("--cyber-map-radar-low-rgb", MAP_COLOR_FALLBACKS.radarLow));
  const high = encodeURIComponent(cssRgbCsv("--cyber-map-radar-high-rgb", MAP_COLOR_FALLBACKS.radarHigh));
  return `/api/radar/{z}/{x}/{y}?mode=${mode}&low=${low}&high=${high}&v=${refreshBucket}`;
}

function radarOpacityMultiplier() {
  return Math.max(0, Math.min(1, readCssNumber("--cyber-map-radar-opacity", 100) / 100));
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

const cyberpunkStyle = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    openfreemap: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
    },
    [RADAR_SOURCE_ID]: {
      type: "raster",
      tiles: ["/api/radar/{z}/{x}/{y}?mode=spectrum&v=0"],
      tileSize: 256,
      maxzoom: 7,
      attribution: RAIN_RADAR_ATTRIBUTION_LABEL,
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
        "background-color": "rgb(37 39 40)",
      },
    },
    {
      id: "water",
      type: "fill",
      source: "openfreemap",
      "source-layer": "water",
      paint: {
        "fill-color": "rgb(191 232 255)",
      },
    },
    {
      id: "landuse",
      type: "fill",
      source: "openfreemap",
      "source-layer": "landuse",
      paint: {
        "fill-color": "rgb(30 32 32)",
        "fill-opacity": landuseOpacityExpression(),
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
        "line-color": "rgb(215 255 50 / 0.18)",
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
        "line-color": "rgb(215 255 50 / 0.36)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1, 16, 2.4],
      },
    },
    {
      id: "building-footprint",
      type: "fill",
      source: "openfreemap",
      "source-layer": "building",
      paint: {
        "fill-color": buildingHeightColorExpression("rgb(215 255 50)", "rgb(255 255 255)"),
        "fill-opacity": buildingFootprintOpacityExpression(),
      },
    },
    {
      id: "building-3d",
      type: "fill-extrusion",
      source: "openfreemap",
      "source-layer": "building",
      paint: {
        "fill-extrusion-color": buildingHeightColorExpression("rgb(215 255 50)", "rgb(255 255 255)"),
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
        "text-size": ["interpolate", ["linear"], ["zoom"], 13, 9, 16, 12],
      },
      paint: {
        "text-color": "rgb(215 255 50)",
        "text-halo-color": "#252728",
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
        "text-color": "rgb(215 255 50)",
        "text-halo-color": "#252728",
        "text-halo-width": 1.5,
      },
    },
  ],
} as StyleSpecification;

function applyMapTheme(map: maplibregl.Map) {
  const baseColor = cssRgb("--cyber-map-base-rgb", MAP_COLOR_FALLBACKS.base);
  const buildingLowColor = cssRgb("--cyber-map-building-low-rgb", MAP_COLOR_FALLBACKS.buildingLow);
  const buildingHighColor = cssRgb("--cyber-map-building-high-rgb", MAP_COLOR_FALLBACKS.buildingHigh);
  const labelColor = cssRgb("--cyber-map-labels-rgb", MAP_COLOR_FALLBACKS.labels);
  const roadColor = "--cyber-map-roads-rgb";

  if (map.getLayer("background")) {
    map.setPaintProperty("background", "background-color", baseColor);
  }
  if (map.getLayer("water")) {
    map.setPaintProperty("water", "fill-color", cssRgb("--cyber-map-water-rgb", MAP_COLOR_FALLBACKS.water));
  }
  if (map.getLayer("landuse")) {
    map.setPaintProperty("landuse", "fill-color", cssRgb("--cyber-map-land-rgb", MAP_COLOR_FALLBACKS.land));
    map.setPaintProperty("landuse", "fill-opacity", landuseOpacityExpression());
  }

  if (map.getLayer("building-footprint")) {
    map.setPaintProperty("building-footprint", "fill-color", buildingHeightColorExpression(buildingLowColor, buildingHighColor));
    map.setPaintProperty("building-footprint", "fill-opacity", buildingFootprintOpacityExpression());
  }

  if (map.getLayer("building-3d")) {
    map.setPaintProperty("building-3d", "fill-extrusion-color", buildingHeightColorExpression(buildingLowColor, buildingHighColor));
    map.setPaintProperty("building-3d", "fill-extrusion-opacity", buildingExtrusionOpacityExpression());
  }
  if (map.getLayer("road-major")) {
    map.setPaintProperty("road-major", "line-color", cssRgbWithOpacity(roadColor, MAP_COLOR_FALLBACKS.roads, 0.36));
  }
  if (map.getLayer("road-minor")) {
    map.setPaintProperty("road-minor", "line-color", cssRgbWithOpacity(roadColor, MAP_COLOR_FALLBACKS.roads, 0.18));
  }
  if (map.getLayer("label-street")) {
    map.setPaintProperty("label-street", "text-color", labelColor);
  }
  if (map.getLayer("label-place")) {
    map.setPaintProperty("label-place", "text-color", labelColor);
  }
  if (map.getLayer(RADAR_LAYER_ID)) {
    map.setPaintProperty(RADAR_LAYER_ID, "raster-opacity", radarOpacityExpression(radarOpacityMultiplier()));
  }
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
      style: cyberpunkStyle,
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
