"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardState } from "../../../lib/types";
import {
  POWER_ZONE,
  POWER_ZONE_ID,
  TASKS_ZONE_ID,
  WORLD_ZONE,
  WORLD_ZONE_ID,
} from "./shared";
import {
  removeLegacySelectedZoneParam,
  selectedZoneIdFromStorage,
  writeSelectedZoneToStorage,
} from "./shell";

export function useDashboardSelection(data: DashboardState | null) {
  const [selectedZoneId, setSelectedZoneId] = useState(selectedZoneIdFromStorage);

  // Until the first payload arrives we cannot know whether power is configured,
  // so treat it as available and let the effect below correct a stale choice
  // once the server has told us. That keeps a configured home from flickering
  // off its remembered zone on every reload.
  const powerAvailable = !data || (data.activeModuleIds?.includes("power") ?? false);

  const selectedZone = useMemo(() => {
    if (selectedZoneId === POWER_ZONE_ID && powerAvailable) {
      return POWER_ZONE;
    }
    if (selectedZoneId === WORLD_ZONE_ID) {
      return WORLD_ZONE;
    }
    if (!data || selectedZoneId === TASKS_ZONE_ID) {
      return null;
    }
    return data.zones.find((zone) => zone.id === selectedZoneId) ?? data.zones[0] ?? null;
  }, [data, powerAvailable, selectedZoneId]);

  useEffect(() => {
    if (
      data &&
      selectedZoneId !== TASKS_ZONE_ID &&
      (selectedZoneId !== POWER_ZONE_ID || !powerAvailable) &&
      selectedZoneId !== WORLD_ZONE_ID &&
      !data.zones.some((zone) => zone.id === selectedZoneId)
    ) {
      const fallbackZoneId = data.zones[0]?.id ?? "everything";
      setSelectedZoneId(fallbackZoneId);
      writeSelectedZoneToStorage(fallbackZoneId);
    }
  }, [data, powerAvailable, selectedZoneId]);

  useEffect(() => {
    removeLegacySelectedZoneParam();

    const syncSelectedZoneFromStorage = () => {
      setSelectedZoneId(selectedZoneIdFromStorage());
    };

    window.addEventListener("pageshow", syncSelectedZoneFromStorage);

    return () => {
      window.removeEventListener("pageshow", syncSelectedZoneFromStorage);
    };
  }, []);

  useEffect(() => {
    writeSelectedZoneToStorage(selectedZoneId);
  }, [selectedZoneId]);

  const selectZone = useCallback((zoneId: string) => {
    setSelectedZoneId(zoneId);
    writeSelectedZoneToStorage(zoneId);
  }, []);

  return {
    selectedZone,
    selectedZoneId,
    selectZone,
    tasksZoneSelected: selectedZoneId === TASKS_ZONE_ID,
  };
}
