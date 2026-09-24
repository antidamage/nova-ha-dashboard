"use client";

import { useMemo } from "react";
import type { DashboardState, DashboardZone, SunStatus, WeatherStatus } from "../../../../lib/types";
import type { EntityActionsHandler } from "../climateCommands";
import type { SlotView } from "./slotViewContext";

/**
 * The view every panel's slots are drawn with, built once from the dashboard's
 * own state and commands (specs/control-modules.md).
 *
 * Memoised, and that is the point rather than a micro-optimisation: a provider
 * value built inline is a new object on every dashboard render, which re-renders
 * every slot host on the page — and the dashboard re-renders on every poll. The
 * dependencies are the pieces a placed module actually reads.
 *
 * It also keeps `app/components/Dashboard.tsx` inside its file-size allowance: the
 * eight pieces this view is wired from would otherwise be eight more lines in a
 * file the ratchet forbids from growing (specs/agent-token-footprint.md).
 */
export function useDashboardSlotView(input: {
  commands: {
    onEntityActions: EntityActionsHandler;
    onNotice?: (message: string) => void;
    onZoneAction: (zone: DashboardZone, action: string, body?: Record<string, unknown>) => Promise<void>;
  };
  climateZone?: DashboardZone | null;
  data: DashboardState | null;
  knobSkin?: "auto" | "dark" | "light";
  sun?: SunStatus | null;
  weather?: WeatherStatus | null;
}): SlotView {
  const { climateZone, commands, data, knobSkin, sun, weather } = input;
  const { onEntityActions, onNotice, onZoneAction } = commands;
  return useMemo(
    () => ({ climateZone, data, knobSkin, onEntityActions, onNotice, onZoneAction, sun, weather }),
    [climateZone, data, knobSkin, onEntityActions, onNotice, onZoneAction, sun, weather],
  );
}
