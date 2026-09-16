"use client";

import { SwitchRow } from "../../SlideSwitch";
import type { DeviceTheme } from "../../theme/accent/types";
import type { SetConfigTheme } from "./accent-config-model";
import { BackgroundEffectControls } from "./BackgroundEffectControls";
import { DesktopWallpaperControl } from "./DesktopWallpaperControl";
import { WallpaperSyncButton } from "./WallpaperSyncButton";

export function BackgroundSection({
  accentRgb,
  highlightRgb,
  setTheme,
  theme,
}: {
  accentRgb: [number, number, number];
  highlightRgb: [number, number, number];
  setTheme: SetConfigTheme;
  theme: DeviceTheme;
}) {
  return (
    <>
            <SwitchRow
              checked={theme.desktopWallpaper.useAsDashboardBackground}
              label="Use Wallpaper as Background"
              detail={
                theme.desktopWallpaper.useAsDashboardBackground
                  ? "The dashboard shows the wallpaper below instead of the fluid background"
                  : "The dashboard shows the fluid background; wallpapers below are only pushed to managed computers"
              }
              onChange={(useAsDashboardBackground) =>
                setTheme({
                  ...theme,
                  desktopWallpaper: { ...theme.desktopWallpaper, useAsDashboardBackground },
                })
              }
            />
            <WallpaperSyncButton />
            <DesktopWallpaperControl
              value={theme.desktopWallpaper}
              onChange={(desktopWallpaper) => setTheme({ ...theme, desktopWallpaper })}
            />
            {theme.desktopWallpaper.useAsDashboardBackground ? null : (
              <BackgroundEffectControls
                accentColor={accentRgb}
                highlightColor={highlightRgb}
                value={theme.backgroundEffect}
                onChange={(backgroundEffect) => setTheme({ ...theme, backgroundEffect })}
                onPreview={(backgroundEffect) => setTheme({ ...theme, backgroundEffect }, { persist: false })}
              />
            )}
    </>
  );
}
