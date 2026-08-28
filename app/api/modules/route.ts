import { NextResponse } from "next/server";
import { moduleStatusReports, reloadModule } from "../../../lib/modules/runtime/loader";
import { installModulePackage, moduleSummaries } from "../../../lib/modules/runtime/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const summaries = await moduleSummaries(moduleStatusReports());
    return NextResponse.json({ modules: summaries }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list modules" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("package");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload a ZIP in the 'package' field" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json({ error: "Module packages must be ZIP files" }, { status: 400 });
    }
    const installed = await installModulePackage(new Uint8Array(await file.arrayBuffer()), `upload:${file.name}`);
    // Installing over a running module replaces its code, so the old instance
    // has to be disposed and the new one loaded before anyone can use it.
    await reloadModule(installed.id);
    const summaries = await moduleSummaries(moduleStatusReports());
    return NextResponse.json(
      { module: summaries.find((entry) => entry.id === installed.id) ?? null },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to install module" },
      { status: 400 },
    );
  }
}
