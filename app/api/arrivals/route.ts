import { arrivalTargets } from "../../../lib/arrivals/targets";
import { patchDashboardConfig, readDashboardConfig } from "../../../lib/dashboard-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The Household members config section's own API: the household member list
 * with each member's states, and which presets every target can offer right now.
 *
 * The write is the whole `dashboard.people` array, because a person is one
 * record — renaming someone, making them primary or giving them a state are the
 * same edit, and the section holds the whole list it was given. It goes through
 * patchDashboardConfig, so the schema validates it and a member that does not
 * match the shape is refused with the field that is wrong.
 */
async function payload() {
  const config = await readDashboardConfig();
  const presets = await Promise.all(
    arrivalTargets().map(async (target) => [target.kind, await target.presets()] as const),
  );
  return {
    members: config.dashboard.people,
    targets: arrivalTargets().map((target) => ({ kind: target.kind, label: target.label })),
    presets: Object.fromEntries(presets) as Record<
      string,
      Array<{ id: string; label: string; group?: string }>
    >,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number) {
  return jsonResponse({ error: message }, status);
}

export async function GET() {
  try {
    return jsonResponse(await payload());
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to read the arrival settings",
      500,
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { people?: unknown };
    if (!Array.isArray(body.people)) {
      return errorResponse("A people array is required", 400);
    }
    const written = await patchDashboardConfig({ dashboard: { people: body.people } });
    if (!written.ok) {
      return errorResponse(
        written.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
        400,
      );
    }
    return jsonResponse(await payload());
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to save the arrival settings",
      400,
    );
  }
}
