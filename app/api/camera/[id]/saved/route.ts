import { NextResponse } from "next/server";
import { getCamera } from "../../../../../lib/camera/config";
import { listRanges, RangeSaveError, startSave } from "../../../../../lib/camera/saved-ranges";
import { validSelection } from "../../../../../lib/camera/saved-ranges-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Saved ranges of a camera's footage: list them, or save one. specs/camera-saved-ranges.md. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const camera = getCamera(id);
  if (!camera) return NextResponse.json({ error: "Unknown camera" }, { status: 404 });
  return NextResponse.json({ ranges: await listRanges(camera) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const camera = getCamera(id);
  if (!camera) return NextResponse.json({ error: "Unknown camera" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { startMs?: unknown; endMs?: unknown } | null;
  if (!validSelection(body?.startMs, body?.endMs)) {
    return NextResponse.json({ error: "A range needs a start and an end at least a second apart." }, { status: 400 });
  }
  try {
    const range = await startSave(camera, body?.startMs as number, body?.endMs as number);
    return NextResponse.json({ range }, { status: 202 });
  } catch (error) {
    if (error instanceof RangeSaveError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("[nova-dashboard] camera range save failed to start", { cameraId: id, error });
    return NextResponse.json({ error: "Could not reach the recording." }, { status: 502 });
  }
}
