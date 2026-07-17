import { NextResponse } from "next/server";
import { getCamera } from "../../../../../lib/camera/config";
import { restartRecorder } from "../../../../../lib/camera/recorder";
import { requestCameraReinit } from "../../../../../lib/camera/reinit-control";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "Re-initialise everything about the camera." Two halves:
//   1. Software (instant, in-app): race-free restart of the encoder, which
//      re-resolves the source — this alone fixes the common "device replugged
//      but the feed is stuck on the test pattern / a stale error" case.
//   2. Hardware (host, root): queue a full USB re-init request for the camera
//      watchdog to drain on its next tick — free the device, usbreset, USB
//      re-enumerate. The containerised app can't touch USB sysfs, so it signals
//      the root watchdog via the bind-mounted data dir control channel.
//
// The button is fired behind a double-confirm modal in the config UI. The
// dashboard itself is never restarted — only the camera pipeline + capture
// device.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const camera = getCamera(id);
  if (!camera || id !== "outside") {
    return NextResponse.json({ error: "Unknown camera" }, { status: 404 });
  }

  let requestedBy = "config";
  try {
    const body = (await request.json()) as { requestedBy?: string };
    if (typeof body.requestedBy === "string" && body.requestedBy.trim()) {
      requestedBy = body.requestedBy.trim().slice(0, 40);
    }
  } catch {
    // no body is fine
  }

  console.log("[nova-dashboard] camera reinitialize requested", { cameraId: id, requestedBy });

  // 1. Software restart now (fast path).
  let recorderRestarted = false;
  try {
    recorderRestarted = await restartRecorder(camera);
  } catch (error) {
    console.warn("[nova-dashboard] camera reinitialize: recorder restart failed", { error });
  }

  // 2. Queue the host-side USB re-init for the watchdog.
  let hostQueued = false;
  try {
    await requestCameraReinit(id, requestedBy);
    hostQueued = true;
  } catch (error) {
    console.warn("[nova-dashboard] camera reinitialize: could not queue host re-init", { error });
  }

  return NextResponse.json({
    ok: true,
    cameraId: id,
    recorderRestarted,
    hostReinitQueued: hostQueued,
    // The watchdog picks up the host re-init within its poll interval (~60s);
    // the recorder restart is immediate.
    note: "Recorder restarted immediately; a full USB re-initialisation has been queued for the host watchdog.",
  });
}
