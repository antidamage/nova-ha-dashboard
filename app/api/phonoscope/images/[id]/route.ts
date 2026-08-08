import { NextResponse } from "next/server";

import { readPhonoscopeImageFile } from "../../../../../lib/phonoscope-images";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The bytes, for the engines and the editor's thumbnails.
 *
 * Cached hard and for a long time: every URL carries `?v=<updatedAt>`, and an
 * id is never reused, so the only way the content behind one of these URLs can
 * change is if the file is replaced under the same id — which nothing does.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const file = await readPhonoscopeImageFile(id);
    if (!file) return NextResponse.json({ error: "No such image" }, { status: 404 });
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(file.data.byteLength),
        // From the manifest's recorded format, not assumed: the library holds
        // PNG, JPEG and WebP, and a JPEG served as `image/png` decodes nowhere.
        "Content-Type": file.contentType,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read the image" },
      { status: 500 },
    );
  }
}
