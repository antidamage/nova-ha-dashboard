import { createReadStream } from "fs";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { getCamera } from "../../../../../../lib/camera/config";
import { resolveSnapshot } from "../../../../../../lib/camera/snapshots";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stream a stored snapshot to the browser as a file download. The concatenated
 * .ts can be hours of 1080p (gigabytes), so we stream it off disk rather than
 * buffering it — `Readable.toWeb` bridges the Node fs stream to the web
 * `Response` body Next.js expects.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string; snap: string }> }) {
  const { id, snap } = await context.params;
  const camera = getCamera(id);
  if (!camera) {
    return NextResponse.json({ error: "Unknown camera" }, { status: 404 });
  }

  const snapshot = await resolveSnapshot(camera, snap);
  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

  const nodeStream = createReadStream(snapshot.path);
  const body = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "video/mp2t",
      "Content-Length": String(snapshot.sizeBytes),
      "Content-Disposition": `attachment; filename="${snapshot.downloadName}"`,
      "Cache-Control": "no-store",
    },
  });
}
