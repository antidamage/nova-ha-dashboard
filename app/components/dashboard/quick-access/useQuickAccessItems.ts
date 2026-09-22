"use client";

import { useEffect, useMemo, useState } from "react";
import { CONTROL_MODULES } from "../../../../lib/control-modules/catalogue";
import type { ControlModule, ControlsConfig } from "../../../../lib/control-modules/types";
import type { DashboardState, DashboardZone } from "../../../../lib/types";
import { loadSharedClientConfig, readCachedClientConfig } from "../../sharedConfigCache";
import { buildQuickAccessItems, type QuickItem } from "./quickSlotModel";

/**
 * The Quick Access card's items, resolved from configuration
 * (specs/control-modules.md).
 *
 * The configuration arrives TWICE on purpose, and the order matters:
 *
 *   1. with the dashboard state — authoritative in the running app, and the only
 *      copy that carries installed modules.
 *   2. with the shared client config — the stand-in for any client whose state
 *      payload predates this block, which is the demo shim and any provider older
 *      than the dashboard reading it.
 *
 * Without the second the card renders nothing wherever the state cannot carry
 * the controls, which is exactly how the published demo works.
 *
 * A hook rather than an inline memo at the call site for a mundane reason worth
 * recording: `app/components/Dashboard.tsx` is on the 10 KB size allowance, and
 * an allowance may only shrink.
 */

type ControlConfig = { controls?: ControlsConfig; controlModules?: ControlModule[] };

function readPayload(payload: unknown): ControlConfig {
  const root = payload as { controls?: ControlsConfig; controlModules?: ControlModule[] } | null;
  return { controlModules: root?.controlModules, controls: root?.controls };
}

export function useSharedControlConfig(): ControlConfig {
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

export function useQuickAccessItems(
  data: DashboardState | null,
  climateZone: DashboardZone | null | undefined,
): QuickItem[] {
  const shared = useSharedControlConfig();
  const controls = data?.controls ?? shared.controls;
  const controlModules = data?.controlModules?.length
    ? data.controlModules
    : shared.controlModules?.length
      ? shared.controlModules
      : [...CONTROL_MODULES];
  return useMemo(
    () => buildQuickAccessItems({
      climateZone,
      controlModules,
      controls: controls ?? { presets: [], slots: [] },
      data,
      preferences: data?.preferences,
    }),
    [climateZone, controlModules, controls, data],
  );
}
