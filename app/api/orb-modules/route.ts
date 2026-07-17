import { NextResponse } from "next/server";
import { BUILTIN_ORB_MODULES, type OrbModule } from "../../../lib/orb-modules";
import { readDiskOrbModules } from "../../../lib/orb-modules-disk";

export const dynamic = "force-dynamic";

/**
 * GET /api/orb-modules
 *
 * Returns every available status orb module: the built-ins compiled into the
 * app, overlaid with the JSON files from `config/orb-modules/`. A disk module
 * with the same id as a built-in replaces it, so a deployed host can patch a
 * built-in look in place. Both the web dashboard and the Apple TV client
 * consume this endpoint; built-ins double as the offline fallback.
 *
 * Response shape: `{ modules: OrbModule[], errors: { file, error }[] }` —
 * `errors` lists module files that failed to parse/normalize so a bad drop is
 * diagnosable without host shell access.
 */
export async function GET() {
  try {
    const disk = await readDiskOrbModules();

    // Merge order: built-ins first (stable picker order), disk overrides and
    // additions after. Map semantics give us replace-by-id for free.
    const merged = new Map<string, OrbModule>();
    for (const module of BUILTIN_ORB_MODULES) {
      merged.set(module.id, module);
    }
    for (const module of disk.modules) {
      merged.set(module.id, module);
    }

    return NextResponse.json(
      { modules: [...merged.values()], errors: disk.errors },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read orb modules" },
      { status: 500 },
    );
  }
}
