import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { getCamera } from "../../../../../../../lib/camera/config";
import { rangeVideoPath, readRange } from "../../../../../../../lib/camera/saved-ranges";
import { buildRangePlaylist, parseByteRange } from "../../../../../../../lib/camera/saved-ranges-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A saved range as HLS: a VOD playlist, and the file it addresses by byte range. */
export async function GET(request: Request, context: { params: Promise<{ id: string; rangeId: string; file: string }> }) {
  const { id, rangeId, file } = await context.params;
  const camera = getCamera(id);
  if (!camera) return NextResponse.json({ error: "Unknown camera" }, { status: 404 });
  const meta = await readRange(camera, rangeId);
  if (!meta || meta.state !== "ready") return NextResponse.json({ error: "Range not found" }, { status: 404 });

  if (file === "index.m3u8") {
    return new Response(buildRangePlaylist(meta.segments), {
      headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
    });
  }
  if (file !== "video.ts") return NextResponse.json({ error: "Unknown file" }, { status: 404 });

  const videoPath = rangeVideoPath(camera, rangeId);
  const { size } = await stat(/*turbopackIgnore: true*/ videoPath);
  const headers = { "Content-Type": "video/mp2t", "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  const rangeHeader = request.headers.get("range");
  if (rangeHeader === null) {
    const body = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ videoPath)) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, { headers: { ...headers, "Content-Length": String(size) } });
  }
  const range = parseByteRange(rangeHeader, size);
  if (range === null) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const body = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ videoPath, range)) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(range.end - range.start + 1),
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
    },
  });
}
