import { NextResponse } from "next/server";
import {
  readWallpaperAssetFile,
  removeWallpaperAsset,
} from "../../../../../lib/wallpaper-assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { asset, data } = await readWallpaperAssetFile(id);
    return new NextResponse(data, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${asset.name.replace(/"/g, "")}"`,
        "Content-Length": String(data.byteLength),
        "Content-Type": asset.contentType,
      },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read desktop wallpaper" },
      { status: code === "ENOENT" ? 404 : 400 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const result = await removeWallpaperAsset(id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to remove desktop wallpaper" },
      { status: 400 },
    );
  }
}
