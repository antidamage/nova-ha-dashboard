"use client";

import { Settings } from "lucide-react";
import type { DashboardState } from "../../lib/types";
import { GatedLink } from "./auth/GatedLink";
import type { useDeviceTheme } from "./accentColor";
import { HeaderFadeStrip } from "./dashboard/HeaderFadeStrip";
import { FluidBackground } from "./FluidBackground";
import { ReloadButton } from "./ReloadButton";
import { RotateDisplayButton } from "./RotateDisplayButton";
import { ThemeOverrideButton } from "./ThemeOverrideButton";
import { UpdateBanner } from "./UpdateBanner";
import { WallpaperBackground } from "./WallpaperBackground";

/**
 * The dashboard's stateless chrome: background, the corner buttons, the config
 * link, the update banner and the Home Assistant reconnecting chip. Rendered by
 * Dashboard.tsx at the top of the shell; it holds no state of its own.
 */
export function DashboardChrome({
  haHealth,
  showBackground,
  theme,
}: {
  haHealth: DashboardState["haHealth"] | undefined;
  showBackground: boolean;
  theme: ReturnType<typeof useDeviceTheme>["theme"];
}) {
  return (
    <>
      {/* Background off: no WebGL, and the shell flattens to the plain
          theme colour (specs/experience-modes.md). */}
      {showBackground ? (
        theme.desktopWallpaper.useAsDashboardBackground ? (
          <WallpaperBackground wallpaper={theme.desktopWallpaper} />
        ) : (
          <FluidBackground theme={theme} />
        )
      ) : null}
      <HeaderFadeStrip />
      <ReloadButton />
      <ThemeOverrideButton />
      <RotateDisplayButton />
      <GatedLink
        className="dashboard-config-link"
        href="/config"
        aria-label="Configuration"
        data-demo-tooltip-title="Config"
        data-demo-tooltip="Open dashboard theme and setup tools."
      >
        <Settings className="h-5 w-5" aria-hidden="true" />
      </GatedLink>

      <UpdateBanner />

      {haHealth?.status === "degraded" ? (
        // Home Assistant returned a mass-unavailable snapshot (restart/reload).
        // The server is holding last-known-good state (lib/ha/health.ts), so
        // tiles keep their values dimmed rather than all flipping to dead —
        // this chip is the only outward sign of the blip.
        <div
          className="pointer-events-none fixed left-1/2 top-3 z-50 -translate-x-1/2 border border-amber-300/60 bg-neutral-950/90 px-4 py-2 text-xs font-black uppercase tracking-wide text-amber-200 shadow-2xl"
          role="status"
          aria-live="polite"
        >
          Reconnecting to Home Assistant…
        </div>
      ) : null}
    </>
  );
}
