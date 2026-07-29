import { NextResponse } from "next/server";
import { readPhonoscopeSource, removePhonoscopeModule } from "../../../../../../lib/phonoscope-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; version: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id, version } = await context.params;
    return new NextResponse(await readPhonoscopeSource(id, version), {
      headers: { "Content-Type": "application/yaml; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Module not found" }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id, version } = await context.params;
    await removePhonoscopeModule(id, version);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to remove module" }, { status: 400 });
  }
}
