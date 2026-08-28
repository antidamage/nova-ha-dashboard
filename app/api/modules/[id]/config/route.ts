import { NextResponse } from "next/server";
import { saveModuleSecret } from "../../../../../lib/dashboard-secrets";
import { notifyModuleConfigChanged, reloadModule } from "../../../../../lib/modules/runtime/loader";
import {
  coerceModuleConfig,
  exportableModuleConfig,
  readManifest,
  readModuleConfig,
  writeModuleConfig,
} from "../../../../../lib/modules/runtime/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const manifest = await readManifest(id);
  if (!manifest) {
    return NextResponse.json({ error: "Module not found" }, { status: 404 });
  }
  const config = coerceModuleConfig(manifest, await readModuleConfig(id));

  if (new URL(request.url).searchParams.get("export") === "1") {
    // Secret VALUES are omitted, not blanked, so an exported file cannot be
    // mistaken for one that carries a token.
    return NextResponse.json(
      {
        moduleId: id,
        version: manifest.version,
        exportedAt: new Date().toISOString(),
        config: exportableModuleConfig(manifest, config),
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="${id}-config.json"`,
        },
      },
    );
  }

  return NextResponse.json(
    { config, schema: manifest.configSchema, messages: manifest.messages },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * `{ config }` replaces the module's config; `{ secrets: { name: value } }`
 * writes into the dashboard secrets store instead, so a secret never lands in
 * config.json where an export could pick it up.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const manifest = await readManifest(id);
    if (!manifest) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }
    const body = (await request.json()) as { config?: unknown; secrets?: unknown };

    if (body.secrets && typeof body.secrets === "object" && !Array.isArray(body.secrets)) {
      for (const [name, value] of Object.entries(body.secrets as Record<string, unknown>)) {
        if (!manifest.secrets.includes(name)) {
          return NextResponse.json({ error: `Unknown secret "${name}"` }, { status: 400 });
        }
        await saveModuleSecret(name, value);
      }
    }

    let config = await readModuleConfig(id);
    if (body.config !== undefined) {
      config = coerceModuleConfig(manifest, body.config);
      await writeModuleConfig(id, config);
    }

    // A running module is told rather than restarted: a config change should not
    // drop a gateway connection or lose a queue that has not flushed yet.
    notifyModuleConfigChanged(id, config);
    // A secret change is different — it is usually what the module needed to
    // connect at all, so reload it to pick the value up.
    if (body.secrets) {
      await reloadModule(id);
    }
    return NextResponse.json({ config });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save module config" },
      { status: 400 },
    );
  }
}
