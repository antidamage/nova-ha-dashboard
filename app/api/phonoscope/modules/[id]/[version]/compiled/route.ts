import { NextResponse } from "next/server";
import { readPhonoscopeCompiledModule } from "../../../../../../../lib/phonoscope-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; version: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id, version } = await context.params;
    const result = await readPhonoscopeCompiledModule(id, version);
    return NextResponse.json(result.module, {
      headers: {
        "Cache-Control": "private, max-age=0, must-revalidate",
        ETag: `"${result.hash}"`,
        "X-Phonoscope-Hash": result.hash,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Module not found" }, { status: 404 });
  }
}
