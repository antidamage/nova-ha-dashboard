"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DashboardState, DashboardZone, SunStatus, WeatherStatus } from "../../../../lib/types";
import type { EntityActionsHandler } from "../climateCommands";

/**
 * What a panel's slots need in order to draw a placed module
 * (specs/control-modules.md).
 *
 * One provider at the dashboard root, because the alternative is worse: every
 * panel that can hold a slot would otherwise take six more props it does not use
 * itself, purely to hand them to whatever the owner places there. A panel asks
 * for its slots and nothing else; this is where the modules they hold find the
 * state they drive.
 */
export type SlotView = {
  data: DashboardState | null;
  /** The zone the installation files its climate devices under. */
  climateZone?: DashboardZone | null;
  /** Forwarded to ColorEncoder; see DeviceTheme.knobSkin, specs/color-encoder.md. */
  knobSkin?: "auto" | "dark" | "light";
  sun?: SunStatus | null;
  weather?: WeatherStatus | null;
  onEntityActions: EntityActionsHandler;
  /**
   * A zone action from a lighting module, bound to THAT module's room: a
   * lighting module placed in any panel must act on the room it serves.
   */
  onZoneAction: (zone: DashboardZone, action: string, body?: Record<string, unknown>) => Promise<void>;
  onNotice?: (message: string) => void;
};

const SlotViewContext = createContext<SlotView | null>(null);

export function SlotViewProvider({ children, view }: { children: ReactNode; view: SlotView }) {
  return <SlotViewContext.Provider value={view}>{children}</SlotViewContext.Provider>;
}

/**
 * The view a panel's slots are drawn with, or null.
 *
 * Null is a real answer, not a failure: the Plain design mounts the same panels
 * (ZonesPanel, ClockPanel) around its own chrome and has no slot view, and a
 * panel with none draws its own content and nothing else — the same thing an
 * unconfigured panel does. Throwing here would take that whole surface down for a
 * feature it does not use.
 */
export function useSlotView(): SlotView | null {
  return useContext(SlotViewContext);
}
