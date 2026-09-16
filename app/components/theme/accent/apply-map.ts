"use client";

// CSS-variable application for the map, radar and reminder-glow values.
import { appliedThemeRgb } from "./color-model";
import { DEFAULT_THEME } from "./defaults";
import {
  normalizeMapBuildingOpacity,
  normalizeMapLabelSize,
  normalizePercent,
  normalizeRadarOpacity,
  normalizeTaskGlowIntensity,
} from "./normalize-model";
import type { DeviceTheme, ThemeColorValue, ThemeMapLayerValue } from "./types";

export function applyCssMap(map: DeviceTheme["map"]) {
  const root = document.documentElement;
  const setMapColor = (name: string, color: ThemeColorValue) => {
    const rgb = appliedThemeRgb(color);
    const value = `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
    root.style.setProperty(`--cyber-map-${name}`, `rgb(${value})`);
    root.style.setProperty(`--cyber-map-${name}-rgb`, value);
  };

  setMapColor("base", map.base);
  setMapColor("water", map.water);
  setMapColor("land", map.land);
  setMapColor("building-low", map.buildingLow);
  setMapColor("building-high", map.buildingHigh);
  setMapColor("roads", map.roads);
  setMapColor("labels", map.labels);
  setMapColor("radar-low", map.radarLow);
  setMapColor("radar-high", map.radarHigh);
}

export function applyCssMapWater(water: ThemeMapLayerValue) {
  const root = document.documentElement;
  root.style.setProperty("--cyber-map-water-enabled", water.enabled ? "1" : "0");
  root.style.setProperty("--cyber-map-water-opacity", String(normalizePercent(water.opacity, DEFAULT_THEME.mapWater.opacity)));
}

export function applyCssMapLabelSize(value: number) {
  document.documentElement.style.setProperty("--cyber-map-label-size", String(normalizeMapLabelSize(value)));
}

export function applyCssMapBuildingOpacity(value: number) {
  document.documentElement.style.setProperty("--cyber-map-building-opacity", String(normalizeMapBuildingOpacity(value)));
}

export function applyCssRadarOpacity(value: number) {
  document.documentElement.style.setProperty("--cyber-map-radar-opacity", String(normalizeRadarOpacity(value)));
}

export function applyCssTaskGlowIntensity(value: number) {
  const intensity = normalizeTaskGlowIntensity(value);
  const scale = intensity / 100;
  const root = document.documentElement;

  root.style.setProperty("--task-glow-intensity", String(intensity));
  root.style.setProperty("--task-glow-cyan-blur", `${Math.round(128 * scale)}px`);
  root.style.setProperty("--task-glow-cyan-spread", `${Math.round(42 * scale)}px`);
  root.style.setProperty("--task-glow-line-blur", `${Math.round(72 * scale)}px`);
  root.style.setProperty("--task-glow-line-spread", `${Math.round(18 * scale)}px`);
  root.style.setProperty("--task-glow-cyan-alpha", Math.min(1, 0.7 * scale).toFixed(3));
  root.style.setProperty("--task-glow-line-alpha", Math.min(1, 0.72 * scale).toFixed(3));
}
