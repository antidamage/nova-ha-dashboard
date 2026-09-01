"use client";

import { useEffect, useState } from "react";
import type { DesktopWallpaperSettings } from "./accentColor";

function useIsLandscape() {
  const [landscape, setLandscape] = useState(true);

  useEffect(() => {
    const update = () => setLandscape(window.innerWidth >= window.innerHeight);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return landscape;
}

// Renders one of the uploaded desktop-wallpaper assets as the dashboard's own
// full-screen background, in place of the fluid shader (see
// specs/wallpaper-background-mode.md). Picks landscape or portrait to match
// the window's own aspect ratio, falling back to whichever asset exists if
// only one orientation was uploaded. Scaled to uniform-fill (cover) and
// centered, never stretched.
export function WallpaperBackground({ wallpaper }: { wallpaper: DesktopWallpaperSettings }) {
  const landscape = useIsLandscape();
  const preferred = landscape ? wallpaper.landscapeAssetId : wallpaper.portraitAssetId;
  const fallback = landscape ? wallpaper.portraitAssetId : wallpaper.landscapeAssetId;
  const assetId = preferred ?? fallback;

  if (!assetId) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="dashboard-wallpaper-background"
      style={{ backgroundImage: `url(/api/desktop/wallpapers/${assetId})` }}
    />
  );
}
