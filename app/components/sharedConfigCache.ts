"use client";

import type { ConfigImportResult, SecretSetupStatus } from "../../lib/config-schema";

export const SHARED_CONFIG_STORAGE_KEY = "nova.dashboard.sharedConfig.v1";
export const SHARED_CONFIG_CHANGE_EVENT = "nova-shared-config-change";

type ConfigResponse = {
  config?: unknown;
  error?: string;
  secrets?: SecretSetupStatus;
};

type SharedConfigCache = {
  clientConfig?: unknown;
  config?: unknown;
  savedAt: string;
  secrets?: SecretSetupStatus;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readStorageText() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(SHARED_CONFIG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorageValue(value: SharedConfigCache) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SHARED_CONFIG_STORAGE_KEY, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(SHARED_CONFIG_CHANGE_EVENT, { detail: value }));
  } catch {
    // Storage can be unavailable in restricted browser contexts; network reads still work.
  }
}

function readCache(): SharedConfigCache | null {
  const text = readStorageText();
  if (!text) {
    return null;
  }

  try {
    const value = JSON.parse(text) as SharedConfigCache;
    return recordValue(value) ? value : null;
  } catch {
    return null;
  }
}

export function clientConfigFromDashboardConfig(config: unknown) {
  const root = recordValue(config);
  const dashboard = recordValue(root?.dashboard);

  if (!root || !dashboard) {
    return null;
  }

  return {
    dashboard: {
      aircon: dashboard.aircon,
      avatar: dashboard.avatar,
      defaultZoneId: dashboard.defaultZoneId,
      lighting: dashboard.lighting,
      specialZones: dashboard.specialZones,
      timing: dashboard.timing,
    },
    mapWeather: root.mapWeather,
    theme: root.theme,
  };
}

export function readSharedConfigCache() {
  return readCache();
}

export function readCachedClientConfig() {
  const cache = readCache();
  return cache?.clientConfig ?? clientConfigFromDashboardConfig(cache?.config) ?? null;
}

export function cacheSharedClientConfig(clientConfig: unknown) {
  const current = readCache();
  writeStorageValue({
    ...(current ?? {}),
    clientConfig,
    savedAt: new Date().toISOString(),
  });
}

export function cacheSharedConfig(config: unknown, secrets?: SecretSetupStatus) {
  const current = readCache();
  writeStorageValue({
    ...(current ?? {}),
    clientConfig: clientConfigFromDashboardConfig(config) ?? current?.clientConfig,
    config,
    savedAt: new Date().toISOString(),
    secrets: secrets ?? current?.secrets,
  });
}

export async function loadSharedClientConfig<T = unknown>() {
  const response = await fetch("/api/config/client", { cache: "no-store" });
  const payload = await response.json() as T;

  if (!response.ok) {
    throw new Error(`Shared client config request failed: ${response.status}`);
  }

  cacheSharedClientConfig(payload);
  return payload;
}

export async function loadSharedConfig(): Promise<ConfigResponse> {
  const response = await fetch("/api/config", { cache: "no-store" });
  const payload = await response.json() as ConfigResponse;

  if (!response.ok) {
    throw new Error(payload.error ?? `Shared config request failed: ${response.status}`);
  }

  if (payload.config !== undefined) {
    cacheSharedConfig(payload.config, payload.secrets);
  }
  return payload;
}

export async function saveSharedConfig(config: unknown): Promise<ConfigImportResult> {
  const response = await fetch("/api/config", {
    body: JSON.stringify({ config }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
  const payload = await response.json() as ConfigImportResult & { error?: string };

  if (response.ok && payload.ok && payload.config !== undefined) {
    cacheSharedConfig(payload.config);
  }
  return payload;
}
