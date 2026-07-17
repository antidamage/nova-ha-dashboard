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

    // Unlike restart-dashboard, this must NOT self-exit: the whole point is to
    // also bounce Home Assistant and the other host containers, which only the
    // host helper (ops/nova-system) can do via `docker restart`. So we always
    // write the control-file request and let nova-system orchestrate the restart
    // (services first, the dashboard container last). The per-minute cron means
    // up to ~60s before it begins; the reconnect blocker covers the window.
    const queued = await requestSystemAction("restart-stack", { requestedBy });
    return NextResponse.json({ queued });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to queue services restart" },
      { status: 500 },
    );
  }
}
