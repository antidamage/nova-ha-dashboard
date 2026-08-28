import { NextResponse } from "next/server";
import { packModule, readManifest } from "../../../../../lib/modules/runtime/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Re-pack an installed module as a ZIP. `config.json` is never included. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const manifest = await readManifest(id);
  if (!manifest) {
    return NextResponse.json({ error: "Module not found" }, { status: 404 });
  }
  try {
    const bytes = await packModule(id);
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${id}-${manifest.version}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to pack module" },
      { status: 500 },
    );
  }
}
