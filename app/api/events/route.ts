import { NextResponse } from "next/server";
import { subscribeDashboardEvents } from "../../../lib/dashboard-events";
import { emitDashboardEvent, type DashboardEventPhase } from "../../../lib/event-spool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET = the shared SSE stream (server -> browsers). POST = client-originated
// attributed events (button presses, the aircon auto loop) headed the OTHER way,
// into the nova-monitoring event stream via the data/events spool.
export async function GET() {
  return new Response(subscribeDashboardEvents(), {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

const PHASES: DashboardEventPhase[] = ["start", "end", "point"];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      service?: unknown;
      event?: unknown;
      source?: unknown;
      phase?: unknown;
      detail?: unknown;
    };

    const service = typeof body.service === "string" ? body.service.trim() : "";
    const event = typeof body.event === "string" ? body.event.trim() : "";
    if (!service || !event) {
      return NextResponse.json({ error: "service and event are required" }, { status: 400 });
    }

    const phase = PHASES.includes(body.phase as DashboardEventPhase)
      ? (body.phase as DashboardEventPhase)
      : "point";
    const detail =
      body.detail && typeof body.detail === "object" && !Array.isArray(body.detail)
        ? (body.detail as Record<string, string | number | boolean | null | undefined>)
        : undefined;

    await emitDashboardEvent({
      service: service.slice(0, 60),
      event: event.slice(0, 60),
      source: typeof body.source === "string" && body.source.trim() ? body.source.trim().slice(0, 20) : "user",
      phase,
      detail,
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Malformed body — accept quietly; events are best-effort telemetry.
    return NextResponse.json({ ok: true });
  }
}
