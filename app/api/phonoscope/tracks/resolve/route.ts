import { NextResponse } from "next/server";
import { resolvePhonoscopeTrack } from "../../../../../lib/phonoscope-tracks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const analysis = await resolvePhonoscopeTrack(body.track ?? body);
    return NextResponse.json({ analysis }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Track enrichment failed" }, { status: 400 });
  }
}
