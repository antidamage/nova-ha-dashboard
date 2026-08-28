import { NextResponse } from "next/server";
import {
  moduleStatusReports,
  reloadModule,
  unloadModule,
} from "../../../../lib/modules/runtime/loader";
import {
  deleteModule,
  moduleSummaries,
  patchInstalledRecord,
  readManifest,
} from "../../../../lib/modules/runtime/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function summaryFor(id: string) {
  const summaries = await moduleSummaries(moduleStatusReports());
  return summaries.find((entry) => entry.id === id) ?? null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const summary = await summaryFor(id);
  if (!summary) {
    return NextResponse.json({ error: "Module not found" }, { status: 404 });
  }
  return NextResponse.json({ module: summary }, { headers: { "Cache-Control": "no-store" } });
}

/** `{ enabled: boolean }` to enable/disable, `{ action: "reload" }` to reload. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!(await readManifest(id))) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }
    const body = (await request.json().catch(() => ({}))) as { enabled?: unknown; action?: unknown };

    if (body.action === "reload") {
      await reloadModule(id);
      return NextResponse.json({ module: await summaryFor(id) });
    }

    if (typeof body.enabled === "boolean") {
      await patchInstalledRecord(id, { enabled: body.enabled });
      if (body.enabled) {
        await reloadModule(id);
      } else {
        await unloadModule(id);
        await patchInstalledRecord(id, { state: "disabled", error: undefined });
      }
      return NextResponse.json({ module: await summaryFor(id) });
    }

    return NextResponse.json({ error: "Send { enabled } or { action: \"reload\" }" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update module" },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // Dispose before the files go, so a module with a socket or a timer gets its
    // chance to close cleanly rather than being orphaned in the process.
    await unloadModule(id);
    await deleteModule(id);
    return NextResponse.json({ deleted: id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete module" },
      { status: 400 },
    );
  }
}
