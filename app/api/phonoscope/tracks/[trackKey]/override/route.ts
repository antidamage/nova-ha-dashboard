import { NextResponse } from "next/server";
import { readPhonoscopeTrackOverride, writePhonoscopeTrackOverride } from "../../../../../../lib/phonoscope-tracks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ trackKey: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { trackKey } = await context.params;
    return NextResponse.json({ override: await readPhonoscopeTrackOverride(trackKey) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to read override" }, { status: 400 });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { trackKey } = await context.params;
    return NextResponse.json({ override: await writePhonoscopeTrackOverride(trackKey, await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save override" }, { status: 400 });
  }
}
