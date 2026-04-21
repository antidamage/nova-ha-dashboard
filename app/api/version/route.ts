import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function buildId() {
  try {
    return (await readFile(join(process.cwd(), ".next", "BUILD_ID"), "utf8")).trim();
  } catch {
    return process.env.NOVA_DASHBOARD_BUILD_ID ?? "development";
  }
}

export async function GET() {
  return NextResponse.json(
    {
      buildId: await buildId(),
      generatedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
