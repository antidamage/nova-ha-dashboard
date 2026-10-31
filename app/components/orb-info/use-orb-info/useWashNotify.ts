"use client";

import { type Dispatch, type SetStateAction, useCallback } from "react";
import type { OrbInfoSources } from "../../../../lib/orb-info/types";

/**
 * Turn the running wash's finish notification on or off — the status orb's bell.
 * The response carries the fresh power reading, so the bell redraws at once
 * rather than on the next poll (specs/power-meters.md, "The wash's timer").
 */
export function useWashNotify(setWashing: Dispatch<SetStateAction<OrbInfoSources["washing"]>>) {
  return useCallback(async (notify: boolean) => {
    const response = await fetch("/api/power/washing-machine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notify }) });
    if (!response.ok) throw new Error("Wash notification change failed");
    const data = await response.json() as { washingMachine?: OrbInfoSources["washing"] };
    if (data.washingMachine !== undefined) setWashing(data.washingMachine);
  }, [setWashing]);
}
