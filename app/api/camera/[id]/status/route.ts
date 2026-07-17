import { NextResponse } from "next/server";
import { getCamera } from "../../../../../lib/camera/config";
import { ensureRecorder, recorderStatus } from "../../../../../lib/camera/recorder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lightweight status for the player: source (real device vs synthetic clock),
 * whether recording is live, and the available DVR window so the scrubber can
 * label its extent. Starting the recorder here too means simply opening the
 * camera panel is enough to bring the stream up.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const camera = getCamera(id);
  if (!camera) {
    return NextResponse.json({ error: "Unknown camera" }, { status: 404 });
  }

  await ensureRecorder(camera);
  const status = await recorderStatus(camera);
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
