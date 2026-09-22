import { NextResponse } from "next/server";
import { ControlsConfigSchema } from "../../../lib/config-schema/controls";
import { allControlModules, installedControlModules, refreshInstalledModules } from "../../../lib/control-modules/registry";
import { effectiveControls, presetProblems } from "../../../lib/control-modules/presets";
import { HOME_ZONE_ID } from "../../../lib/control-modules/rooms";
import { hasStoredPresets } from "../../../lib/control-modules/stored";
import { patchDashboardConfig, readDashboardConfig } from "../../../lib/dashboard-config";
import { readRegistrySnapshot, resolveAreaId } from "../../../lib/ha/registry";

/**
 * Control modules and their presets (specs/control-modules.md).
 *
 * A preset list is runtime configuration, not a shipped default, so it belongs
 * in `data/dashboard-config.json` — which is what this route writes, and why the
 * household overlay cannot supply one. Arrays replace wholesale in the config
 * merge, so a stored empty list would shadow a household one; storing presets
 * here is the only shape that cannot produce two answers.
 *
 * A save carrying a STRUCTURAL problem is refused (nothing can render a preset
 * whose module is not installed). A save carrying a missing device field is
 * not: a half-built preset is a normal state while it is being filled in, and
 * the problems come back with the response for the Devices list to show.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BINDABLE_DOMAINS = new Set(["climate", "sensor", "switch"]);
const MAX_ENTITY_OPTIONS = 600;

/** The rooms a preset may serve, and the entities it may be bound to. */
async function pickerOptions() {
  const home = [{ id: HOME_ZONE_ID, name: "Home", detail: "Every light except the ones config excludes" }];
  try {
    const snapshot = await readRegistrySnapshot();
    const areas = snapshot.areas
      .map((area) => ({ id: resolveAreaId(area), name: String(area.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const entities = snapshot.entities
      .map((entry) => ({
        domain: String(entry.entity_id).split(".")[0],
        id: String(entry.entity_id),
        name: String(entry.original_name ?? entry.name ?? entry.entity_id),
      }))
      .filter((entry) => BINDABLE_DOMAINS.has(entry.domain))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_ENTITY_OPTIONS);
    return { entities, rooms: [...home, ...areas] };
  } catch {
    // A registry read that fails costs the pickers their lists, not the page.
    return { entities: [], rooms: home };
  }
}

export async function GET() {
  try {
    const config = await readDashboardConfig();
    const controls = effectiveControls(config);
    // The config page is the one place an install can be observed, so it is the
    // one read that re-reads the install directory: an uploaded device type has
    // to appear without restarting the dashboard.
    const installErrors = await refreshInstalledModules();
    const modules = allControlModules();
    const { entities, rooms } = await pickerOptions();
    return NextResponse.json(
      {
        controls,
        derived: !hasStoredPresets(config),
        entities,
        installErrors,
        installedIds: installedControlModules().map((module) => module.id),
        modules,
        problems: presetProblems(controls.presets, modules),
        rooms,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read the control configuration" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { controls?: unknown };
    const submitted = (body.controls ?? body) as { presets?: unknown; slots?: unknown } | null;
    // A body carrying neither list would validate — every field defaults — and
    // write an EMPTY configuration over the owner's, with `configured` set, so a
    // stray POST of `{}` would empty the card with no way back. The lists have to
    // be there to be replaced.
    if (!submitted || !Array.isArray(submitted.presets) || (submitted.slots !== undefined && !Array.isArray(submitted.slots))) {
      return NextResponse.json(
        { error: "A control configuration needs a presets list (and a slots list, when it has one)" },
        { status: 400 },
      );
    }
    const parsed = ControlsConfigSchema.safeParse(submitted);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ") },
        { status: 400 },
      );
    }
    const problems = presetProblems(parsed.data.presets, allControlModules());
    const blocking = problems.filter((problem) => problem.severity === "error");
    if (blocking.length) {
      return NextResponse.json({ error: blocking.map((problem) => problem.message).join("; "), problems }, { status: 400 });
    }
    // The route sets the flag rather than trusting the body: a client that sent
    // `configured: false` would store a list that renders as the derivation.
    const controls = { ...parsed.data, configured: true };
    const result = await patchDashboardConfig({ dashboard: { controls } });
    if (!result.ok) {
      const detail = result.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
      return NextResponse.json({ error: `The configuration was rejected: ${detail}`, problems }, { status: 400 });
    }
    return NextResponse.json({ controls, derived: false, problems });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save the control configuration" },
      { status: 400 },
    );
  }
}
