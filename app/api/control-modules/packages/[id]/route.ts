import { NextResponse } from "next/server";
import { modulePackageDocument, removeInstalledModule } from "../../../../../lib/control-modules/library";
import { allControlModules, installedControlModules, refreshInstalledModules } from "../../../../../lib/control-modules/registry";

/**
 * Downloading or removing one device module (specs/control-modules.md).
 *
 * Download is how a module travels: the same JSON that installs on this
 * dashboard installs on someone else's, which is the point of a module being a
 * device type rather than a component. It carries the definition only — a
 * preset holds this household's entity ids and rooms and stays here.
 *
 * Only an INSTALLED module can be removed. A shipped one is part of the build,
 * and deleting it would leave presets naming a module the code still exports.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await refreshInstalledModules();
  const module = allControlModules().find((candidate) => candidate.id === id);
  if (!module) {
    return NextResponse.json({ error: `No module called "${id}"` }, { status: 404 });
  }
  const shipped = !installedControlModules().some((candidate) => candidate.id === id);
  return new NextResponse(`${JSON.stringify(modulePackageDocument(module), null, 2)}\n`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${id}.module.json"`,
      "Content-Type": "application/json",
      ...(shipped ? { "X-Nova-Shipped-Module": "true" } : {}),
    },
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await refreshInstalledModules();
  const installed = installedControlModules().some((candidate) => candidate.id === id);
  if (!installed) {
    return NextResponse.json(
      { error: allControlModules().some((candidate) => candidate.id === id)
        ? `"${id}" ships with this build and cannot be removed`
        : `No module called "${id}"` },
      { status: 400 },
    );
  }
  await removeInstalledModule(id);
  const installErrors = await refreshInstalledModules();
  return NextResponse.json({ installErrors, removed: id });
}
