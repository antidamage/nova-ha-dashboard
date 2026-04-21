import { subscribeDashboardEvents } from "../../../lib/dashboard-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
