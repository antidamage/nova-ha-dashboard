import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { manifestEntries } from "../../../../../lib/modules/runtime/manifest";
import { clientVersionToken, moduleDir, readManifest } from "../../../../../lib/modules/runtime/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Serves a module's client bundle so the browser can `import()` it at runtime
 * (`specs/module-system.md` §2). The ETag is mtime+size derived and matches the
 * `?v=` token the module list hands out, so a reinstalled module is fetched
 * fresh rather than served from cache.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const manifest = await readManifest(id);
  if (!manifest) {
    return NextResponse.json({ error: "Module not found" }, { status: 404 });
  }
  const entry = manifestEntries(manifest).client;
  try {
    const source = await readFile(path.join(moduleDir(id), entry), "utf8");
    return new NextResponse(source, {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
        ETag: `"${await clientVersionToken(id, entry)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Module has no client bundle" }, { status: 404 });
  }
}
