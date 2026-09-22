import { NextResponse } from "next/server";
import { parseModulePackage, writeInstalledModule } from "../../../../lib/control-modules/library";
import { packageContext, refreshInstalledModules } from "../../../../lib/control-modules/registry";

/**
 * Installing a device module (specs/control-modules.md).
 *
 * A package is one JSON document — `{ packageVersion: 1, module: {...} }` — and
 * it is validated against the shipped vocabulary before a byte is written, so a
 * package that names a behaviour or a driver this build does not have fails the
 * install rather than producing a device type that renders and does nothing.
 *
 * What a package may NOT do, and why it is a refusal rather than a warning: it
 * cannot bring its own drawing. A renderer is compiled into the dashboard, so a
 * control module must name one this build ships. A package that needs to carry
 * real code is an installable module (`specs/module-system.md`), not this.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { package?: unknown };
    const context = packageContext();
    const parsed = parseModulePackage(body.package ?? body, context);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    // Re-uploading the same id is how a module is upgraded, in place. A shipped
    // id was already refused by parseModulePackage.
    await writeInstalledModule(parsed.module);
    const installErrors = await refreshInstalledModules();
    return NextResponse.json({ module: parsed.module, installErrors }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to install the module" },
      { status: 400 },
    );
  }
}
