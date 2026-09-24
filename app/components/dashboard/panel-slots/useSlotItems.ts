"use client";

import { useEffect, useMemo, useState } from "react";
import { CONTROL_MODULES } from "../../../../lib/control-modules/catalogue";
import { HOME_ZONE_ID } from "../../../../lib/control-modules/rooms";
import type { ControlModule, ControlSlotSurface, ControlsConfig } from "../../../../lib/control-modules/types";
import type { DashboardState, DashboardZone } from "../../../../lib/types";
import { loadSharedClientConfig, readCachedClientConfig } from "../../sharedConfigCache";
import { buildSlotItems, type QuickItem } from "../quick-access/quickSlotModel";

/**
 * A panel's items, resolved from configuration (specs/control-modules.md) — the
 * Quick Access card's hook, asked for whichever surface it is (`surface`).
 *
 * The configuration arrives TWICE on purpose, and the order matters:
 *
 *   1. with the dashboard state — authoritative in the running app, and the only
 *      copy that carries installed modules.
 *   2. with the shared client config — the stand-in for any client whose state
 *      payload predates this block, which is the demo shim and any provider older
 *      than the dashboard reading it.
 *
 * Without the second a panel renders nothing wherever the state cannot carry the
 * controls, which is exactly how the published demo works.
 */

type ControlConfig = { controls?: ControlsConfig; controlModules?: ControlModule[] };

function readPayload(payload: unknown): ControlConfig {
  const root = payload as { controls?: ControlsConfig; controlModules?: ControlModule[] } | null;
  return { controlModules: root?.controlModules, controls: root?.controls };
}

function useSharedControlConfig(): ControlConfig {
  const [config, setConfig] = useState<ControlConfig>(() => readPayload(readCachedClientConfig()));
  useEffect(() => {
    let alive = true;
    void loadSharedClientConfig()
      .then((payload) => {
        if (alive) setConfig(readPayload(payload));
      })
      .catch(() => {
        // Keep the cached answer when the config cannot be read.
      });
    return () => {
      alive = false;
    };
  }, []);
  return config;
}

/**
 * A surface's items, and whether the configuration they come from is known yet.
 *
 * `ready` is not a nicety: a panel whose content is a module must draw that
 * content when nothing has been configured, and an unknown configuration is not
 * the same answer as a configured-but-empty one. Without the distinction a panel
 * renders NOTHING until the config arrives — a blank clock, a blank room menu,
 * and a permanently empty panel if the fetch fails, which is exactly the flash
 * this change caused until the e2e caught it.
 */
export function useSlotItems(
  surface: ControlSlotSurface,
  data: DashboardState | null,
  climateZone: DashboardZone | null | undefined,
  /** The room this panel's slots inherit; see QuickSlotInput.roomId. */
  roomId: string | null = HOME_ZONE_ID,
): { items: QuickItem[]; ready: boolean } {
  const shared = useSharedControlConfig();
  const controls = data?.controls ?? shared.controls;
  const controlModules = data?.controlModules?.length
    ? data.controlModules
    : shared.controlModules?.length
      ? shared.controlModules
      : [...CONTROL_MODULES];
  const items = useMemo(
    () =>
      buildSlotItems({
        climateZone,
        controlModules,
        controls: controls ?? { presets: [], slots: [] },
        data,
        preferences: data?.preferences,
        roomId,
        surface,
      }),
    [climateZone, controlModules, controls, data, roomId, surface],
  );
  return { items, ready: controls != null };
}
