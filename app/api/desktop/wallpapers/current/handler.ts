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
/**
 * Resolve the wallpaper the current theme would hand a client asking now.
 *
 * Shared by every route under this directory - the image bytes, the `.png`
 * alias, and the extracted colour - so all of them resolve the dark/light
 * variant and the portrait-to-landscape fallback identically. Clients asking
 * at the same moment must not disagree about which picture is current.
 *
 * Returns `null` when the theme has no desktop wallpaper, which each caller
 * turns into its own 404.
 */
export async function resolveCurrentWallpaper(request: Request) {
  const orientation = new URL(request.url).searchParams.get("orientation") === "landscape"
    ? "landscape"
    : "portrait";
  const preferences = await readDashboardPreferences();
  const config = await readDashboardConfig();
  const theme = themeResponseValue(preferences.theme, config.dashboard.avatar);
  const resolved = await currentDesktopWallpaperAssetId(theme, orientation);
  if (!resolved?.assetId) {
    return null;
  }
  const { asset, data } = await readWallpaperAssetFile(resolved.assetId);
  return { asset, data, orientation, variant: resolved.variant } as const;
}

/**
 * Metadata a client can branch on without a second request. Every route in
 * this directory emits the same set, so a colour response and an image
 * response can be matched up.
 */
export function wallpaperMetadataHeaders(asset: { id: string; updatedAt: string }, variant: string) {
  return {
    "Cache-Control": "no-store",
    "X-Nova-Theme-Variant": variant,
    "X-Nova-Wallpaper-Id": asset.id,
    "X-Nova-Wallpaper-Updated-At": asset.updatedAt,
  };
}

export function noCurrentWallpaperResponse() {
  return NextResponse.json({ error: "The current theme has no desktop wallpaper" }, { status: 404 });
}

export async function currentWallpaperResponse(request: Request) {
  try {
    const resolved = await resolveCurrentWallpaper(request);
    if (!resolved) {
      return noCurrentWallpaperResponse();
    }

    const { asset, data } = resolved;
    return new NextResponse(data, {
      headers: {
        ...wallpaperMetadataHeaders(asset, resolved.variant),
        "Content-Length": String(data.byteLength),
        "Content-Type": asset.contentType,
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
