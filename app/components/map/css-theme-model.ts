// Reads the live --cyber-map-* CSS variables the theme writes, and the tile
// URL templates derived from them.
import {
  BUILDING_EXTRUSION_OPACITY,
  BUILDING_FOOTPRINT_OPACITY,
  DEMO_MODE,
  MAP_COLOR_FALLBACKS,
  RADAR_PALETTE_MODE_FALLBACK,
  RADAR_REFRESH_INTERVAL_MS,
  TRANSPARENT_TILE,
} from "./constants";

export function readCssRgb(variableName: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim() || fallback;
}

export function readCssNumber(variableName: string, fallback: number) {
  const parsed = Number(getComputedStyle(document.documentElement).getPropertyValue(variableName).trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function cssRgb(variableName: string, fallback: string) {
  return `rgb(${readCssRgb(variableName, fallback)})`;
}

export function cssRgbWithOpacity(variableName: string, fallback: string, opacity: number) {
  return `rgb(${readCssRgb(variableName, fallback)} / ${opacity})`;
}

export function cssRgbCsv(variableName: string, fallback: string) {
  return readCssRgb(variableName, fallback).replace(/\s+/g, ",");
}
export function radarPaletteMode() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--cyber-map-radar-mode").trim().toLowerCase();
  return value === "spectrum" ? "spectrum" : RADAR_PALETTE_MODE_FALLBACK;
}

export function radarTileTemplate(refreshBucket = Math.floor(Date.now() / RADAR_REFRESH_INTERVAL_MS)) {
  if (DEMO_MODE) {
    return TRANSPARENT_TILE;
  }
  const mode = radarPaletteMode();
  const low = encodeURIComponent(cssRgbCsv("--cyber-map-radar-low-rgb", MAP_COLOR_FALLBACKS.radarLow));
  const high = encodeURIComponent(cssRgbCsv("--cyber-map-radar-high-rgb", MAP_COLOR_FALLBACKS.radarHigh));
  return `/api/radar/{z}/{x}/{y}?mode=${mode}&low=${low}&high=${high}&v=${refreshBucket}`;
}

export function radarOpacityMultiplier() {
  return Math.max(0, Math.min(1, readCssNumber("--cyber-map-radar-opacity", 87) / 100));
}

export function satelliteEnabled() {
  return readCssNumber("--cyber-map-satellite", 1) >= 0.5;
}

export function mapLabelSizeMultiplier() {
  return Math.max(0.5, Math.min(2, readCssNumber("--cyber-map-label-size", 150) / 100));
}

export function buildingExtrusionOpacity() {
  return Math.max(0, Math.min(1, readCssNumber("--cyber-map-building-opacity", BUILDING_EXTRUSION_OPACITY * 100) / 100));
}

export function buildingFootprintOpacity() {
  return buildingExtrusionOpacity() * (BUILDING_FOOTPRINT_OPACITY / BUILDING_EXTRUSION_OPACITY);
}

export function waterOpacityMultiplier() {
  if (readCssNumber("--cyber-map-water-enabled", 1) < 0.5) {
    return 0;
  }

  return Math.max(0, Math.min(1, readCssNumber("--cyber-map-water-opacity", 10) / 100));
}
export function satelliteTileTemplate() {
  if (DEMO_MODE) {
    return TRANSPARENT_TILE;
  }
  const base = encodeURIComponent(cssRgbCsv("--cyber-map-base-rgb", MAP_COLOR_FALLBACKS.base));
  return `/api/satellite/{z}/{x}/{y}?base=${base}`;
}
