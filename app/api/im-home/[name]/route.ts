import { runArrivalEvent } from "../../../../lib/arrivals/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/im-home/<name> — a home user has arrived: records presence, runs the
 * occupancy rules, then their arrival presets. /api/arrival/<name> is the same
 * call. See specs/home-users.md section 5.
 */
export async function GET(request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  return runArrivalEvent("arrival", name, request);
}
