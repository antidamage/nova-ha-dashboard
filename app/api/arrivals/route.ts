import { arrivalTargets } from "../../../lib/arrivals/targets";
import { effectiveControls } from "../../../lib/control-modules/presets";
import { patchDashboardConfig, readDashboardConfig } from "../../../lib/dashboard-config";
import { buildDashboardState } from "../../../lib/ha";

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
/** The rooms a home user can be given: every real zone, Outside included. */
async function rooms(climateAreaNames: string[]) {
  const climate = new Set(climateAreaNames.map((name) => name.trim().toLowerCase()));
  try {
    const state = await buildDashboardState();
    return state.zones
      .filter((zone) => !zone.special && zone.id !== "everything" && zone.id !== "network")
      .filter((zone) => !climate.has(zone.name.trim().toLowerCase()))
      .map((zone) => ({ id: zone.id, name: zone.name }));
  } catch {
    return [];
  }
}

function controlPresets(config: Awaited<ReturnType<typeof readDashboardConfig>>) {
  try {
    return effectiveControls(config).presets.map(({ id, moduleId, name }) => ({ id, moduleId, name }));
  } catch {
    // A config the control model cannot read offers no presets, not an error.
    return [];
  }
}

async function payload() {
  const config = await readDashboardConfig();
  const presets = await Promise.all(
    arrivalTargets().map(async (target) => [target.kind, await target.presets()] as const),
  );
  return {
    members: config.dashboard.people,
    rooms: await rooms(config.homeAssistant?.climateAreaNames ?? []),
    zones: config.dashboard.zones ?? [],
    controlPresets: controlPresets(config),
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
    const body = (await request.json()) as { people?: unknown; zones?: unknown };
    if (!Array.isArray(body.people)) {
      return errorResponse("A people array is required", 400);
    }
    // The zone flags travel with the people when the section edits them.
    const dashboard = Array.isArray(body.zones) ? { people: body.people, zones: body.zones } : { people: body.people };
    const written = await patchDashboardConfig({ dashboard });
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
