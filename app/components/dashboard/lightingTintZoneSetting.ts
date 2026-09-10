"use client";

import { useCallback, useEffect, useState } from "react";
import { WHOLE_HOUSE_ZONE_ID } from "./lightingTint";

// Which zone's lights this device's tint follows. Per-device like
// auto-fullscreen: set once on each screen from This Device, never part of a
// theme. See specs/lighting-tint.md.
const STORAGE_KEY = "nova.dashboard.lightingTintZone.v1";
const CHANGE_EVENT = "nova-lighting-tint-zone-change";

export function readLightingTintZone(): string {
  if (typeof window === "undefined") {
    return WHOLE_HOUSE_ZONE_ID;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) || WHOLE_HOUSE_ZONE_ID;
  } catch {
    return WHOLE_HOUSE_ZONE_ID;
  }
}

export function useLightingTintZone() {
  // Read in an effect so server-rendered markup matches hydration.
  const [zoneId, setZoneIdState] = useState(WHOLE_HOUSE_ZONE_ID);

  useEffect(() => {
    const sync = () => setZoneIdState(readLightingTintZone());
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === STORAGE_KEY) sync();
    };
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setZoneId = useCallback((next: string) => {
    setZoneIdState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be denied in private/restricted contexts; the in-page state still updates.
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }, []);

  return [zoneId, setZoneId] as const;
}
