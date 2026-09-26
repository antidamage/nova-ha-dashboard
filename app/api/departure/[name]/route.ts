import { runArrivalEvent } from "../../../../lib/arrivals/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/departure/<name> — the household member has left. <name> is a
 * `dashboard.people` id or label; see specs/arrival-and-departure.md.
 */
export async function GET(request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  return runArrivalEvent("departure", name, request);
}
