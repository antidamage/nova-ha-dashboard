import { NextResponse } from "next/server";
import { clampForContrast, highlightColorForAsset } from "../../../../../../lib/wallpaper-color";
import {
  noCurrentWallpaperResponse,
  resolveCurrentWallpaper,
  wallpaperMetadataHeaders,
} from "../handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The dominant highlight colour of the theme's current wallpaper.
 *
 * The point of publishing it is that a client wanting the theme's accent
 * should not have to download a 20MB wallpaper and analyse it - the Windows
 * Terminal tab colour, a phone widget, an LED strip. It resolves the variant
 * and honours `?orientation=` exactly as the sibling image routes do, so the
 * colour always belongs to the picture those routes would serve.
 *
 * `highlight` is the raw extraction; `contrast` is that colour with its
 * lightness pulled into a legible band. Consumers that paint text or chrome
 * want `contrast`; consumers reporting the wallpaper's actual colour want
 * `highlight`. Both are published rather than choosing for them.
 *
 * See `specs/desktop-theme-app-actions.md`.
 */
export async function GET(request: Request) {
  try {
    const resolved = await resolveCurrentWallpaper(request);
    if (!resolved) {
      return noCurrentWallpaperResponse();
    }

    const { asset, data, orientation, variant } = resolved;
    const highlight = await highlightColorForAsset(asset, data);
    const contrast = clampForContrast(highlight);

    return NextResponse.json(
      {
        assetId: asset.id,
        contrast: { hex: contrast.hex, hsl: contrast.hsl, rgb: contrast.rgb },
        fallback: highlight.fallback,
        highlight: { hex: highlight.hex, hsl: highlight.hsl, rgb: highlight.rgb },
        orientation,
        updatedAt: asset.updatedAt,
        variant,
      },
      { headers: wallpaperMetadataHeaders(asset, variant) },
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read the current wallpaper" },
      { status: code === "ENOENT" ? 404 : 500 },
    );
  }
}
