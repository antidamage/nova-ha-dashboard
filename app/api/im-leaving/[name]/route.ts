import { runArrivalEvent } from "../../../../lib/arrivals/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/im-leaving/<name> — a home user has left: records presence, runs the
 * occupancy rules, then their departure presets. /api/departure/<name> is the
 * same call. See specs/home-users.md section 5.
 */
export async function GET(request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  return runArrivalEvent("departure", name, request);
}
