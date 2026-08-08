"use client";

import { useEffect, useState } from "react";
import { loadSharedClientConfig, readCachedClientConfig } from "../sharedConfigCache";

export type BedroomHeaterEntityConfig = {
  switchEntityIds: string[];
  temperatureEntityIds: string[];
  humidityEntityIds: string[];
};

const EMPTY: BedroomHeaterEntityConfig = {
  switchEntityIds: [],
  temperatureEntityIds: [],
  humidityEntityIds: [],
};

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function fromClientConfig(payload: unknown): BedroomHeaterEntityConfig {
  const config = payload as {
    dashboard?: { bedroomHeater?: Record<string, unknown> };
  } | null;
  const block = config?.dashboard?.bedroomHeater;
  if (!block) {
    return EMPTY;
  }
  return {
    switchEntityIds: stringList(block.switchEntityIds),
    temperatureEntityIds: stringList(block.temperatureEntityIds),
    humidityEntityIds: stringList(block.humidityEntityIds),
  };
}

/**
 * The bedroom heater's entity ids are config, not code, so a LAN twin can be
 * put ahead of the cloud twin without a rebuild. Seeded from the shared client
 * config cache so the first paint is not empty.
 */
export function useBedroomHeaterConfig() {
  const [config, setConfig] = useState<BedroomHeaterEntityConfig>(() =>
    fromClientConfig(readCachedClientConfig()),
  );

  useEffect(() => {
    let alive = true;

    void loadSharedClientConfig()
      .then((payload) => {
        if (alive) {
          setConfig(fromClientConfig(payload));
        }
      })
      .catch(() => {
        // Keep whatever the cache gave us when config cannot be read.
      });

    return () => {
      alive = false;
    };
  }, []);

  return config;
}
