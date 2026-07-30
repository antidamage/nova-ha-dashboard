import { NextResponse } from "next/server";
import { readCachedPhonoscopeTrack } from "../../../../../../lib/phonoscope-tracks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ trackKey: string }> }) {
  try {
    const { trackKey } = await context.params;
    const analysis = await readCachedPhonoscopeTrack(trackKey);
    return NextResponse.json({
      trackKey: analysis.trackKey,
      identity: analysis.identity,
      bpm: analysis.bpm,
      beatOffset: analysis.beatOffset,
      timeSignature: analysis.timeSignature,
      source: analysis.beatSource,
      beats: analysis.beatTimes,
      resolvedAt: analysis.resolvedAt,
    }, {
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return NextResponse.json(
      { error: code === "ENOENT" ? "Beat file not found" : error instanceof Error ? error.message : "Unable to read beat file" },
      { status: code === "ENOENT" ? 404 : 400 },
    );
  }
}
