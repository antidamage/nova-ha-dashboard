import { NextResponse } from "next/server";
import { readDashboardConfig } from "../../../../../lib/dashboard-config";
import { currentDesktopWallpaperAssetId } from "../../../../../lib/managed-desktop-sync";
import { readDashboardPreferences } from "../../../../../lib/preferences";
import { themeResponseValue } from "../../../../../lib/theme-values";
import { readWallpaperAssetFile } from "../../../../../lib/wallpaper-assets";

/**
 * The theme's current wallpaper as image bytes, for clients that cannot read
 * the theme themselves - iOS Shortcuts fetches this to set the phone
 * wallpaper. It resolves the dark/light variant exactly the way a managed
 * desktop's sync does, so a phone and a desktop asked at the same moment get
 * the same picture.
 *
 * `?orientation=landscape` serves the landscape asset; the default is portrait
 * (a phone), which falls back to the landscape asset when the theme has no
 * portrait one.
 *
 * Served at both `/api/desktop/wallpapers/current` and
 * `.../current/wallpaper.png`, because some clients will not treat a response
 * as an image unless the URL ends in a file extension. The bytes and the
 * `Content-Type` are the asset's own either way, so the `.png` path can return
 * a JPEG - the extension is there for the client's parser, not as a promise
 * about the format.
 */
export async function currentWallpaperResponse(request: Request) {
  try {
    const orientation = new URL(request.url).searchParams.get("orientation") === "landscape"
      ? "landscape"
      : "portrait";
    const preferences = await readDashboardPreferences();
    const config = await readDashboardConfig();
    const theme = themeResponseValue(preferences.theme, config.dashboard.avatar);
    const resolved = await currentDesktopWallpaperAssetId(theme, orientation);
    if (!resolved?.assetId) {
      return NextResponse.json(
        { error: "The current theme has no desktop wallpaper" },
        { status: 404 },
      );
    }

    const { asset, data } = await readWallpaperAssetFile(resolved.assetId);
    return new NextResponse(data, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Length": String(data.byteLength),
        "Content-Type": asset.contentType,
        // Metadata a Shortcut can branch on without a second request.
        "X-Nova-Wallpaper-Id": asset.id,
        "X-Nova-Wallpaper-Updated-At": asset.updatedAt,
        "X-Nova-Theme-Variant": resolved.variant,
      },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read the current wallpaper" },
      { status: code === "ENOENT" ? 404 : 500 },
    );
  }
}
