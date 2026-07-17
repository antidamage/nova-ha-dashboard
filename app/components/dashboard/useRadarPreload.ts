"use client";

import { useEffect } from "react";
import { preloadRadarTiles, RADAR_REFRESH_INTERVAL_MS } from "./radar";
import { useExperienceFeature } from "./experienceModeSetting";

export function useRadarPreload() {
  // Devices with the world map off never mount the map, so preloading radar
  // tiles (and the maplibre bundle) would be pure waste on exactly the
  // hardware that can least afford it.
  const showWorldMap = useExperienceFeature("worldMap");

  useEffect(() => {
    if (!showWorldMap) {
      return;
    }

    let cancelled = false;
    let preloadInterval: number | null = null;

    const runPreload = () => {
      if (!cancelled) {
        void preloadRadarTiles();
      }
    };

    runPreload();
    void import("../MapPanel");

    const now = Date.now();
    const nextRefreshDelay = Math.max(1000, RADAR_REFRESH_INTERVAL_MS - (now % RADAR_REFRESH_INTERVAL_MS) + 1000);
    const preloadTimeout = window.setTimeout(() => {
      runPreload();
      preloadInterval = window.setInterval(runPreload, RADAR_REFRESH_INTERVAL_MS);
    }, nextRefreshDelay);

    const handleAccentChange = () => runPreload();
    window.addEventListener("nova-accent-change", handleAccentChange);

    return () => {
      cancelled = true;
      window.clearTimeout(preloadTimeout);
      if (preloadInterval !== null) {
        window.clearInterval(preloadInterval);
      }
      window.removeEventListener("nova-accent-change", handleAccentChange);
    };
  }, [showWorldMap]);
}
