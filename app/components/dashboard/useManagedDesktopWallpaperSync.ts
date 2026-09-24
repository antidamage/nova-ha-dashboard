"use client";

import { useEffect, useRef } from "react";
import { requestManagedDesktopWallpaperSync } from "../managed-computers-client";
import type { ThemeVariant } from "../accentColor";

/**
 * Push a dark/light flip to managed desktops, once per flip (specs/theme-and-configuration-ux.md).
 *
 * The dashboard is the only place this runs — a config edit waits for "Back" —
 * so the hook is mounted there and nowhere else. The first resolved variant is
 * recorded without syncing, so a load never pushes anything; only an actual flip
 * does. The sync is deduplicated server-side, so the same image is never re-sent.
 *
 * A hook of its own rather than an effect inside `app/components/Dashboard.tsx`,
 * which is on the 10 KB allowance and may only shrink
 * (specs/agent-token-footprint.md).
 */
export function useManagedDesktopWallpaperSync(input: { activeVariant: ThemeVariant; themeReady: boolean }) {
  const lastSyncedVariantRef = useRef<ThemeVariant | null>(null);
  useEffect(() => {
    if (!input.themeReady) {
      return;
    }
    const previous = lastSyncedVariantRef.current;
    lastSyncedVariantRef.current = input.activeVariant;
    if (previous === null || previous === input.activeVariant) {
      return;
    }
    void requestManagedDesktopWallpaperSync().catch((error) => {
      console.error("[nova-dashboard] managed desktop wallpaper sync failed", error);
    });
  }, [input.activeVariant, input.themeReady]);
}
