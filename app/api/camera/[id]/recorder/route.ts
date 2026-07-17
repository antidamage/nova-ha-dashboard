import { NextResponse } from "next/server";
import { getCamera } from "../../../../../lib/camera/config";
import {
  ensureRecorder,
  recordersPaused,
  restartRecorder,
  setRecordersPaused,
} from "../../../../../lib/camera/recorder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Recorder-level control for the camera watchdog (and manual ops). The
// watchdog historically had only one lever — restart the whole dashboard
// container — so every camera hiccup dropped every SSE client in the house.
// This route exposes the in-process recorder lifecycle instead, so the
// dashboard stays up while the capture pipeline is bounced or the device is
// taken away for USB surgery:
//
//   POST { action: "restart" }  stop + relaunch the recorder ffmpeg in place
//   POST { action: "pause" }    stop the recorder AND block auto-revival
//                               (ensureRecorder no-ops) so the host can probe
//                               and re-enumerate the capture device; a
//                               failsafe timer auto-resumes after
//                               maxPauseSeconds (default 600) in case the
//                               caller dies mid-surgery
//   POST { action: "resume" }   clear the pause and restart the recorder
//
// Optional body fields `reason` / `requestedBy` are logged to journald so
// restarts stay attributable.

const FAILSAFE_KEY = "__novaRecorderPauseFailsafe";

type FailsafeRef = { timer: ReturnType<typeof setTimeout> | null };

function failsafeRef(): FailsafeRef {
  const globalRef = globalThis as unknown as Record<string, FailsafeRef | undefined>;
  if (!globalRef[FAILSAFE_KEY]) {
    globalRef[FAILSAFE_KEY] = { timer: null };
  }
  return globalRef[FAILSAFE_KEY]!;
}

function clearFailsafe() {
  const ref = failsafeRef();
  if (ref.timer) {
    clearTimeout(ref.timer);
    ref.timer = null;
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const camera = getCamera(id);
  if (!camera || id !== "outside") {
    return NextResponse.json({ error: "Unknown camera" }, { status: 404 });
  }
  return NextResponse.json({ paused: recordersPaused() });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const camera = getCamera(id);
  if (!camera || id !== "outside") {
    return NextResponse.json({ error: "Unknown camera" }, { status: 404 });
  }

  let body: {
    action?: string;
    reason?: string;
    requestedBy?: string;
    maxPauseSeconds?: number;
  } = {};
  try {
    body = await request.json();
  } catch {
    // action is required; fall through to the validation error below.
  }

  const action = body.action;
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : "";
  const requestedBy =
    typeof body.requestedBy === "string" && body.requestedBy.trim()
      ? body.requestedBy.trim().slice(0, 40)
      : "api";

  if (action !== "restart" && action !== "pause" && action !== "resume") {
    return NextResponse.json(
      { error: "action must be one of restart | pause | resume" },
      { status: 400 },
    );
  }

  console.log("[nova-dashboard] camera recorder action", {
    action,
    cameraId: id,
    reason,
    requestedBy,
  });

  if (action === "restart") {
    clearFailsafe();
    // Race-free: fully stops the current encoder and waits for the device to be
    // released before spawning a fresh one (which re-resolves the source, so a
    // just-replugged device is picked up). Avoids the overlapping-encoder
    // "Device or resource busy" race the old stop+ensure had.
    const started = await restartRecorder(camera);
    return NextResponse.json({ ok: true, action, started, paused: false });
  }

  if (action === "pause") {
    const rawMax = Number(body.maxPauseSeconds);
    const maxPauseSeconds = Number.isFinite(rawMax)
      ? Math.min(1800, Math.max(30, Math.round(rawMax)))
      : 600;
    setRecordersPaused(true);
    clearFailsafe();
    const ref = failsafeRef();
    ref.timer = setTimeout(() => {
      ref.timer = null;
      if (recordersPaused()) {
        console.warn(
          "[nova-dashboard] camera recorder pause failsafe fired; auto-resuming",
          { cameraId: id, maxPauseSeconds },
        );
        setRecordersPaused(false);
        void ensureRecorder(camera);
      }
    }, maxPauseSeconds * 1000);
    ref.timer.unref?.();
    return NextResponse.json({ ok: true, action, paused: true, maxPauseSeconds });
  }

  // resume
  clearFailsafe();
  setRecordersPaused(false);
  const started = await ensureRecorder(camera);
  return NextResponse.json({ ok: true, action, started, paused: false });
}
