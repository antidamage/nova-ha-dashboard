import { NextResponse } from "next/server";
import {
  listWallpaperAssets,
  uploadWallpaperAsset,
  wallpaperAssetUrl,
} from "../../../../lib/wallpaper-assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function withUrl(asset: Awaited<ReturnType<typeof listWallpaperAssets>>[number]) {
  return {
    ...asset,
    url: wallpaperAssetUrl(asset),
  };
}

export async function GET() {
  try {
    const assets = await listWallpaperAssets();
    return NextResponse.json({ assets: assets.map(withUrl) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list desktop wallpapers" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new Error("Wallpaper image file is required");
    }

    const asset = await uploadWallpaperAsset({
      data: Buffer.from(await file.arrayBuffer()),
      name: file.name,
    });
    return NextResponse.json({ asset: withUrl(asset) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload desktop wallpaper" },
      { status: 400 },
    );
  }
}
