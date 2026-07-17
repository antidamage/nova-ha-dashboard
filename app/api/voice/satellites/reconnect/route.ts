import { NextResponse } from "next/server";
import { reconnectVoiceSatellite } from "../../../../../lib/voice-satellite-reconnect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { id?: unknown };
    if (typeof body.id !== "string" || !body.id.trim()) {
      return NextResponse.json({ error: "A satellite id is required" }, { status: 400 });
    }
    const result = await reconnectVoiceSatellite(body.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reconnect voice satellite" },
      { status: 502 },
    );
  }
}
