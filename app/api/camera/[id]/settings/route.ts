import { NextResponse } from "next/server";
import { getCamera } from "../../../../../lib/camera/config";
import { ensureRecorder, stopRecorder } from "../../../../../lib/camera/recorder";
import { patchDashboardConfig, readDashboardConfig } from "../../../../../lib/dashboard-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const camera = getCamera(id);
  if (!camera || id !== "outside") {
    return NextResponse.json({ error: "Unknown camera" }, { status: 404 });
  }
  const config = await readDashboardConfig();
  const outside = config.dashboard.camera.outside;
  return NextResponse.json({
    ...outside.processing,
    ingestionEnabled: outside.ingestionEnabled,
    videoHostUrl: outside.videoHostUrl ?? "",
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const camera = getCamera(id);
  if (!camera || id !== "outside") {
    return NextResponse.json({ error: "Unknown camera" }, { status: 404 });
  }

  const body = (await request.json()) as {
    brightness?: number;
    contrast?: number;
    sharpness?: number;
    ingestionEnabled?: boolean;
    videoHostUrl?: string;
  };
  const { ingestionEnabled, videoHostUrl, ...processing } = body;
  const outsidePatch: {
    processing?: typeof processing;
    ingestionEnabled?: boolean;
    videoHostUrl?: string;
  } = {};
  // Only patch the processing block if any processing field was actually sent, so
  // a pure enable/disable toggle doesn't clobber saved brightness/contrast/etc.
  const processingChanged =
    typeof processing.brightness === "number" ||
    typeof processing.contrast === "number" ||
    typeof processing.sharpness === "number";
  if (processingChanged) {
    outsidePatch.processing = processing;
  }
  if (typeof ingestionEnabled === "boolean") {
    outsidePatch.ingestionEnabled = ingestionEnabled;
  }
  // The video host pointer is nova config (where the stream is embedded FROM).
  // It never affects the local recorder — capture lives on the remote host.
  if (typeof videoHostUrl === "string") {
    outsidePatch.videoHostUrl = videoHostUrl.trim();
  }

  const result = await patchDashboardConfig({ dashboard: { camera: { outside: outsidePatch } } });
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  // Apply processing/ingestion changes to the LOCAL recorder (the same-origin
  // fallback path). A pure videoHostUrl change must NOT churn the recorder.
  if (processingChanged || typeof ingestionEnabled === "boolean") {
    // When disabled, stop and DON'T restart (this also kills the test pattern);
    // when enabled, (re)start it.
    stopRecorder(id);
    if (result.config.dashboard.camera.outside.ingestionEnabled) {
      await ensureRecorder(camera);
    }
  }
  const outside = result.config.dashboard.camera.outside;
  return NextResponse.json({
    ...outside.processing,
    ingestionEnabled: outside.ingestionEnabled,
    videoHostUrl: outside.videoHostUrl ?? "",
  });
}
