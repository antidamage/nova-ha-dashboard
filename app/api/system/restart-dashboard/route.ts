import { NextResponse } from "next/server";
import { requestSystemAction } from "../../../../lib/system-control";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    let requestedBy = "api";
    try {
      const body = (await request.json()) as { requestedBy?: string };
      if (typeof body.requestedBy === "string" && body.requestedBy.trim()) {
        requestedBy = body.requestedBy.trim().slice(0, 40);
      }
    } catch {
      // No/invalid body is fine.
    }

    // In production the app runs as the sole process inside the container that
    // the systemd unit launches with Restart=always. Exiting therefore restarts
    // the dashboard near-instantly with no host helper or cron lag — far better
    // for the reconnect blocker than the up-to-a-minute control-file path. We
    // flush the 200 first, then exit on the next tick.
    if (process.env.NODE_ENV === "production") {
      // Journald line pairs with the monitoring stream's unit-stopped event so
      // this self-exit restart stays attributable.
      console.log("[nova-dashboard] restart-dashboard self-exit requested", { requestedBy });
      setTimeout(() => process.exit(0), 300);
      return NextResponse.json({ queued: true, method: "self-exit", requestedBy });
    }

    // Dev / non-container: fall back to the file control channel (no-op without
    // the host helper, but never kills a dev server).
    const queued = await requestSystemAction("restart-dashboard", { requestedBy });
    return NextResponse.json({ queued });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to queue dashboard restart" },
      { status: 500 },
    );
  }
}
