import { NextResponse } from "next/server";
import { getCamera } from "../../../../../lib/camera/config";
import { createSnapshot, listSnapshots, MAX_SNAPSHOTS } from "../../../../../lib/camera/snapshots";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Saved-capture management for a camera's rolling DVR window.
 *
 *   GET   list the stored snapshots (newest first) + the retention cap
 *   POST  freeze the current ~two-hour window to a new snapshot on disk; the
 *         round-robin keeps only the newest MAX_SNAPSHOTS (deletes the oldest)
 *
 * Downloads are served by the sibling `[snap]` route.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const camera = getCamera(id);
  if (!camera) {
    return NextResponse.json({ error: "Unknown camera" }, { status: 404 });
  }
  const snapshots = await listSnapshots(camera);
  return NextResponse.json({ snapshots, max: MAX_SNAPSHOTS }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const camera = getCamera(id);
  if (!camera) {
    return NextResponse.json({ error: "Unknown camera" }, { status: 404 });
  }

  try {
    const snapshot = await createSnapshot(camera);
    const snapshots = await listSnapshots(camera);
    console.log("[nova-dashboard] camera snapshot saved", {
      cameraId: id,
      snapshotId: snapshot.id,
      durationSeconds: snapshot.durationSeconds,
      sizeBytes: snapshot.sizeBytes,
    });
    return NextResponse.json({ ok: true, snapshot, snapshots, max: MAX_SNAPSHOTS });
  } catch (error) {
    if (error instanceof Error && error.message === "no-footage") {
      return NextResponse.json(
        { error: "No footage is buffered yet — wait for the feed to record, then try again." },
        { status: 409 },
      );
    }
    console.error("[nova-dashboard] camera snapshot failed", { cameraId: id, error });
    return NextResponse.json({ error: "Failed to save the capture." }, { status: 500 });
  }
}
