import { NextResponse } from "next/server";
import { readDashboardPreferences, replaceDashboardPreferences } from "../../../../lib/preferences";
import {
  buildHistoryTree,
  listPreferencesRevisions,
  preferencesAtRevision,
  restoreSubtrees,
} from "../../../../lib/preferences-history";
import type { DashboardPreferences } from "../../../../lib/types";
import { publishPhonoscopeConfig } from "../../../../lib/dashboard-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET with no `revision` lists the revert points, newest first.
 *
 * With `revision`, returns the whole preference document as it stood then plus
 * a selectable tree of it. `before=1` asks for the state the revision changed
 * away from, which is what "wind back to before this" means — and the only way
 * to recover something the revision deleted.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const revisionId = url.searchParams.get("revision");
    if (!revisionId) {
      return NextResponse.json({ revisions: await listPreferencesRevisions() },
        { headers: { "Cache-Control": "no-store" } });
    }

    const before = url.searchParams.get("before") === "1";
    const found = await preferencesAtRevision(revisionId, { before });
    if (!found) {
      return NextResponse.json({ error: "No such revision" }, { status: 404 });
    }
    const current = await readDashboardPreferences();
    return NextResponse.json({
      revision: found.revision,
      before,
      state: found.state,
      // The revision's own patch, so the tree can mark what moved at this
      // moment. Passing an empty patch here silently disabled those markers.
      tree: buildHistoryTree(found.state, current, found.patch),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read preference history" },
      { status: 500 },
    );
  }
}

/**
 * Restores the selected subtrees from a revision.
 *
 * The result goes through the ordinary preferences write path, so validation,
 * section merging and the usual change events all still run — and the restore
 * is itself recorded as a new revision, so it can be wound back in turn.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      revision?: unknown;
      before?: unknown;
      paths?: unknown;
    };
    const revisionId = typeof body.revision === "string" ? body.revision : "";
    if (!revisionId) return NextResponse.json({ error: "revision is required" }, { status: 400 });
    const paths = Array.isArray(body.paths)
      ? body.paths.filter((entry): entry is string => typeof entry === "string" && entry.startsWith("/"))
      : [];
    if (!paths.length) {
      return NextResponse.json({ error: "Select at least one part to restore" }, { status: 400 });
    }

    const found = await preferencesAtRevision(revisionId, { before: body.before === true });
    if (!found) return NextResponse.json({ error: "No such revision" }, { status: 404 });

    const current = await readDashboardPreferences();
    const restored = restoreSubtrees(current, found.state, paths) as DashboardPreferences;
    // Replaced, not merged: a merge cannot express the removals a restore
    // may need to make. See replaceDashboardPreferences.
    await replaceDashboardPreferences(restored);
    publishPhonoscopeConfig("preferences-restore");

    return NextResponse.json({
      restored: paths,
      revision: found.revision,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to restore preferences" },
      { status: 400 },
    );
  }
}
