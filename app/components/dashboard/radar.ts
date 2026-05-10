"use client";

const DEFAULT_MAP_CENTER = {
  lat: -36.8509,
  lng: 174.7645,
};
const RADAR_PRELOAD_ZOOM = 7;
const RADAR_PRELOAD_RADIUS = 1;
const RADAR_COLOR_FALLBACKS = {
  high: "255 255 255",
  low: "40 243 255",
};

export const RADAR_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function parseMapCenter(value?: string): [number, number] {
  const [latText, lngText] = (value ?? "").split(",").map((part) => part.trim());
  const lat = Number(latText);
  const lng = Number(lngText);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return [DEFAULT_MAP_CENTER.lng, DEFAULT_MAP_CENTER.lat];
  }

  return [lng, lat];
}

function cssRgbCsv(variableName: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim() || fallback;
  return value.replace(/\s+/g, ",");
}

function radarPaletteMode() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--cyber-map-radar-mode").trim().toLowerCase();
  return value === "custom" ? "custom" : "spectrum";
}

function lonLatToTile(lng: number, lat: number, zoom: number): [number, number] {
  const scale = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * scale);
  const latRadians = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRadians) + (1 / Math.cos(latRadians))) / Math.PI) / 2 * scale);

  return [x, y];
}

function radarPreloadUrls(refreshBucket = Math.floor(Date.now() / RADAR_REFRESH_INTERVAL_MS)) {
  const [lng, lat] = parseMapCenter(process.env.NEXT_PUBLIC_MAP_CENTER);
  const [centerTileX, centerTileY] = lonLatToTile(lng, lat, RADAR_PRELOAD_ZOOM);
  const mode = radarPaletteMode();
  const low = encodeURIComponent(cssRgbCsv("--cyber-map-radar-low-rgb", RADAR_COLOR_FALLBACKS.low));
  const high = encodeURIComponent(cssRgbCsv("--cyber-map-radar-high-rgb", RADAR_COLOR_FALLBACKS.high));
  const tileCount = 2 ** RADAR_PRELOAD_ZOOM;
  const urls: string[] = [];

  for (let yOffset = -RADAR_PRELOAD_RADIUS; yOffset <= RADAR_PRELOAD_RADIUS; yOffset += 1) {
    for (let xOffset = -RADAR_PRELOAD_RADIUS; xOffset <= RADAR_PRELOAD_RADIUS; xOffset += 1) {
      const tileX = centerTileX + xOffset;
      const tileY = centerTileY + yOffset;

      if (tileX < 0 || tileY < 0 || tileX >= tileCount || tileY >= tileCount) {
        continue;
      }

      urls.push(`/api/radar/${RADAR_PRELOAD_ZOOM}/${tileX}/${tileY}?mode=${mode}&low=${low}&high=${high}&v=${refreshBucket}`);
    }
  }

  return urls;
}

export async function preloadRadarTiles(refreshBucket = Math.floor(Date.now() / RADAR_REFRESH_INTERVAL_MS)) {
  const urls = radarPreloadUrls(refreshBucket);
  await Promise.allSettled(urls.map((url) => fetch(url, { cache: "force-cache" })));
}
