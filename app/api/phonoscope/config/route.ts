import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { listPhonoscopeModules, readPhonoscopeConfig, writePhonoscopeConfig } from "../../../../lib/phonoscope-store";
import { phonoscopeImageUrls } from "../../../../lib/phonoscope-images";
import { readDashboardPreferences } from "../../../../lib/preferences";
import { normalizeThemeLibrary } from "../../../../lib/theme-library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(value: unknown) {
  const body = JSON.stringify(value);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ETag: `"${createHash("sha256").update(body).digest("hex")}"`,
    },
  });
}

export async function GET() {
  try {
    const [config, modules, preferences, centreImageUrls] = await Promise.all([
      readPhonoscopeConfig(), listPhonoscopeModules(), readDashboardPreferences(),
      phonoscopeImageUrls(),
    ]);
    // The configuration stores centre-image ids; the engines need something
    // fetchable. Resolving here keeps the manifest layout a detail of this
    // service, and the `?v=` in each URL means a re-upload is a new cache key.
    return response({
      config,
      modules,
      themeLibrary: normalizeThemeLibrary(preferences.themeLibrary),
      centreImageUrls,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to read Phonoscope config" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const config = await writePhonoscopeConfig(await request.json());
    return response({ config });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update Phonoscope config" }, { status: 400 });
  }
}
