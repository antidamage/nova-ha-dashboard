import { NextResponse } from "next/server";
import {
  readPhonoscopeNowPlaying,
  writePhonoscopeNowPlaying,
} from "../../../../lib/phonoscope-now-playing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET  — consumed by the GPU renderer on voiceHost, which derives the beat
//        timeline, theme rotation and house-party lighting from it.
// POST — the Apple TV thin client's uplink. MusicKit is only observable on the
//        device Apple Music is playing on, so this is the one piece of state the
//        thin client still originates.
export async function GET() {
  return NextResponse.json(readPhonoscopeNowPlaying(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(writePhonoscopeNowPlaying(await request.json()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to record now-playing" },
      { status: 400 },
    );
  }
}
