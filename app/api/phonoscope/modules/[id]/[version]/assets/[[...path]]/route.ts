import { NextResponse } from "next/server";
import { readPhonoscopeAsset } from "../../../../../../../../lib/phonoscope-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; version: string; path?: string[] }> };

function contentType(file: string) {
  if (file.toLowerCase().endsWith(".png")) return "image/png";
  return "image/jpeg";
}

export async function GET(_request: Request, context: Context) {
  try {
    const { id, version, path } = await context.params;
    const assetPath = (path ?? []).join("/");
    const bytes = await readPhonoscopeAsset(id, version, assetPath);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentType(assetPath),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Asset not found" }, { status: 404 });
  }
}
