import { NextResponse } from "next/server";
import { installPhonoscopePackage, listPhonoscopeModules } from "../../../../lib/phonoscope-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ modules: await listPhonoscopeModules() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list Phonoscope modules" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("package");
    if (!(file instanceof File)) return NextResponse.json({ error: "Upload a ZIP in the 'package' field" }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".zip")) return NextResponse.json({ error: "Phonoscope packages must be ZIP files" }, { status: 400 });
    const module = await installPhonoscopePackage(new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ module }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to install Phonoscope module" }, { status: 400 });
  }
}
