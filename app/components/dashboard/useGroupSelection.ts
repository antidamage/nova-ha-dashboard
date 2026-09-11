"use client";

import { useCallback, useEffect, useState } from "react";
import { homeGroupOwns, type buildZoneTree } from "./ZonesPanel";

// Horizontal dashboard: Home and Systems each keep their own selected zone, so
// picking Climate never closes Bedroom's controls (specs/landscape-layout.md).
// Within a group the choice is exclusive. The global selection (portrait, the
// stored zone, the voice agent) still flows in: whatever it becomes is written
// to the group that owns it, leaving the other group alone.

const STORAGE_KEY = "nova.dashboard.groupZones.v1";

type GroupSelection = { home: string | null; systems: string | null };

function readStored(): GroupSelection {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<GroupSelection> | null;
    return {
      home: typeof parsed?.home === "string" ? parsed.home : null,
      systems: typeof parsed?.systems === "string" ? parsed.systems : null,
    };
  } catch {
    return { home: null, systems: null };
  }
}

export function useGroupSelection(
  zones: ReturnType<typeof buildZoneTree>,
  selectedZoneId: string,
  ready: boolean,
) {
  const [selection, setSelection] = useState<GroupSelection>({ home: null, systems: null });

  useEffect(() => {
    setSelection(readStored());
  }, []);

  // Route the global selection into its group once the zone tree is known.
  useEffect(() => {
    if (!ready || !selectedZoneId) return;
    const group = homeGroupOwns(zones, selectedZoneId) ? "home" : "systems";
    setSelection((current) => (current[group] === selectedZoneId ? current : { ...current, [group]: selectedZoneId }));
  }, [ready, selectedZoneId, zones]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
    } catch {
      // Storage denied: selection just isn't remembered across reloads.
    }
  }, [selection]);

  const groupOf = useCallback((zoneId: string) => (homeGroupOwns(zones, zoneId) ? "home" : "systems"), [zones]);

  return { homeId: selection.home, systemsId: selection.systems, groupOf };
}
