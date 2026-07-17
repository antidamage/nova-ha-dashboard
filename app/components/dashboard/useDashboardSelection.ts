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

  const selectedZone = useMemo(() => {
    if (selectedZoneId === POWER_ZONE_ID) {
      return POWER_ZONE;
    }
    if (selectedZoneId === WORLD_ZONE_ID) {
      return WORLD_ZONE;
    }
    if (!data || selectedZoneId === TASKS_ZONE_ID) {
      return null;
    }
    return data.zones.find((zone) => zone.id === selectedZoneId) ?? data.zones[0] ?? null;
  }, [data, selectedZoneId]);

  useEffect(() => {
    if (
      data &&
      selectedZoneId !== TASKS_ZONE_ID &&
      selectedZoneId !== POWER_ZONE_ID &&
      selectedZoneId !== WORLD_ZONE_ID &&
      !data.zones.some((zone) => zone.id === selectedZoneId)
    ) {
      const fallbackZoneId = data.zones[0]?.id ?? "everything";
      setSelectedZoneId(fallbackZoneId);
      writeSelectedZoneToStorage(fallbackZoneId);
    }
  }, [data, selectedZoneId]);

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
