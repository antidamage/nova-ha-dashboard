import { NextResponse } from "next/server";
import { getCamera } from "../../../../../lib/camera/config";
import { ensureRecorder, readRecordingFile } from "../../../../../lib/camera/recorder";
import { sliceLivePlaylist } from "../../../../../lib/camera/hls-playlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Serves the live HLS playlist (`index.m3u8`) and its MPEG-TS segments
 * (`seg_NNNNNN.ts`) straight off disk. Segment URIs in the playlist are bare
 * filenames, so they resolve against this same `/api/camera/<id>/` path. The
 * recorder is started lazily on first request so the stream spins up the moment
 * the panel mounts. Retention is enforced inside `readRecordingFile`.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await context.params;
  const camera = getCamera(id);
  if (!camera) {
    return NextResponse.json({ error: "Unknown camera" }, { status: 404 });
  }

  const recording = await ensureRecorder(camera);
  if (!recording && file.endsWith(".m3u8")) {
    // No ffmpeg on this host — tell the client to fall back to its placeholder.
    return NextResponse.json({ error: "Recorder unavailable" }, { status: 503 });
  }

  const result = await readRecordingFile(camera, file);
  if ("error" in result) {
    if (result.error === "expired") {
      return NextResponse.json({ error: "Segment outside retention window" }, { status: 410 });
    }
    if (result.error === "invalid") {
      return NextResponse.json({ error: "Invalid file" }, { status: 400 });
    }
    // Playlist may not exist for the first second or two while ffmpeg warms up.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Copy onto a fresh ArrayBuffer-backed view so the body matches the DOM
  // `BufferSource` type (Node's Buffer is generic over ArrayBufferLike).
  const requestedStart = new URL(request.url).searchParams.get("start");
  const data = file.endsWith(".m3u8") && requestedStart !== null
    ? Buffer.from(sliceLivePlaylist(result.data.toString("utf8"), Number.parseInt(requestedStart, 10)), "utf8")
    : result.data;
  const body = Uint8Array.from(data);
  return new NextResponse(body, {
    headers: {
      "Content-Type": result.contentType,
      "Content-Length": String(data.byteLength),
      // The playlist must never be cached (it mutates every segment); segments
      // are immutable so they can be cached for their full retention lifetime.
      "Cache-Control": file.endsWith(".m3u8")
        ? "no-store"
        : "public, max-age=7200, immutable",
    },
  });
}
