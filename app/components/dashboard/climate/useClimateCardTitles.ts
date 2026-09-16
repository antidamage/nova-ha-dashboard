"use client";

import { useEffect, useState } from "react";
import { loadSharedClientConfig, readCachedClientConfig } from "../../sharedConfigCache";

/**
 * What each climate card calls itself. Usually the room it sits in, which is a
 * fact about one floor plan — the components used to say "Lounge" and "Bedroom"
 * outright, so every install inherited this house's rooms.
 */
export function climateCardTitles(payload: unknown) {
  const dashboard = (payload as { dashboard?: { aircon?: { title?: unknown }; bedroomHeater?: { title?: unknown } } } | null)
    ?.dashboard;
  const text = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim() ? value.trim() : fallback;
  return {
    aircon: text(dashboard?.aircon?.title, "Climate"),
    heater: text(dashboard?.bedroomHeater?.title, "Heater"),
  };
}

/** The climate card titles from config, cached first and refreshed once. */
export function useClimateCardTitles() {
  const [titles, setTitles] = useState(() => climateCardTitles(readCachedClientConfig()));

  useEffect(() => {
    let alive = true;
    void loadSharedClientConfig()
      .then((payload) => {
        if (alive) setTitles(climateCardTitles(payload));
      })
      .catch(() => {
        // Keep the cached answer when config cannot be read.
      });
    return () => {
      alive = false;
    };
  }, []);

  return titles;
}
