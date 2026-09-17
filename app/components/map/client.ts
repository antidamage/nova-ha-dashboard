// Map centre: the build-time default and the shared client config's value.
import { loadSharedClientConfig, readCachedClientConfig } from "../sharedConfigCache";
import { DEFAULT_MAP_CENTER } from "./constants";

export function parseMapCenter(value?: string): [number, number] {
  const [latText, lngText] = (value ?? "").split(",").map((part) => part.trim());
  const lat = Number(latText);
  const lng = Number(lngText);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return [DEFAULT_MAP_CENTER.lng, DEFAULT_MAP_CENTER.lat];
  }

  return [lng, lat];
}

export function configuredMapCenterFromPayload(payload: unknown): [number, number] | null {
  const config = payload as { mapWeather?: { center?: { lat?: unknown; lng?: unknown } } } | null;
  const lat = Number(config?.mapWeather?.center?.lat);
  const lng = Number(config?.mapWeather?.center?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  return [lng, lat];
}

export function readCachedConfiguredMapCenter() {
  return configuredMapCenterFromPayload(readCachedClientConfig());
}

export async function fetchConfiguredMapCenter(): Promise<[number, number] | null> {
  try {
    return configuredMapCenterFromPayload(await loadSharedClientConfig());
  } catch {
    return null;
  }
}
