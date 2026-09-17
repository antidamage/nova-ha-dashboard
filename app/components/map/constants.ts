export const DEFAULT_MAP_CENTER = {
  lat: -36.8509,
  lng: 174.7645,
};
export const PAN_PX = 6;
export const LEFT_MOUSE_BUTTON = 0;
export const RIGHT_MOUSE_BUTTON = 2;
export const LEFT_MOUSE_BUTTON_MASK = 1;
export const RIGHT_MOUSE_BUTTON_MASK = 2;
export const MIN_CENTER_ROTATE_SCALE = 0.25;
export const LOW_BUILDING_HEIGHT_METERS = 3;
export const HIGH_BUILDING_HEIGHT_METERS = 15;
export const BUILDING_EXTRUSION_OPACITY = 0.66;
export const BUILDING_FOOTPRINT_OPACITY = 0.2;
export const WHEEL_ZOOM_RATE = 1 / 900;
export const WHEEL_ZOOM_EASE_SECONDS = 0.42;
export const WHEEL_ZOOM_RENDER_THRESHOLD = 0.0006;
export const WHEEL_ZOOM_MAX_DELTA_PER_SECOND = 1.25;
export const RADAR_SOURCE_ID = "rain-radar";
export const RADAR_LAYER_ID = "rain-radar-layer";
export const SATELLITE_SOURCE_ID = "satellite-imagery";
export const SATELLITE_LAYER_ID = "satellite-ground";
export const SATELLITE_ATTRIBUTION =
  "Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community";
export const RADAR_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const RADAR_SOURCE_POLL_MS = 60 * 1000;
export const MAP_COLOR_FALLBACKS = {
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
export const MAJOR_ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary"];
export const RAIN_RADAR_ATTRIBUTION_LABEL = "Radar: RainViewer / MetService";
export const RAIN_RADAR_ATTRIBUTION_URL = "https://www.rainviewer.com/";
export const RADAR_PALETTE_MODE_FALLBACK = "custom";
export const DEMO_MODE = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";
export const TRANSPARENT_TILE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
