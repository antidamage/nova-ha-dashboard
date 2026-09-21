import { NextResponse } from "next/server";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";
import { attributeControl } from "../../../lib/control-attribution";
import { MAX_PLAYLISTS, cleanPlaylists, storedPlaylists } from "../../../lib/apple-tv/playlists";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The amplifier dial's playlist presets (Adeline, 2026-09-22).
 *
 * The dial is the placeholder for the IR emitter that will drive the amp, so
 * this route carries no volume and no mute — only the list of Apple Music
 * playlists its preset buttons will play. There is no playlist endpoint on the
 * Apple TV to read from yet, so the list is typed in rather than fetched, and
 * it lives in the dashboard's own preferences.
 *
 * The list is always written whole and normalised on the way in: bounds,
 * blanks, duplicates and stray whitespace are the server's business, so a
 * second client cannot store a list the dial cannot draw.
 */
export async function GET() {
  const preferences = await readDashboardPreferences();
  return NextResponse.json({ playlists: storedPlaylists(preferences.appleTV?.playlists) });
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const playlists = (body as { playlists?: unknown } | null)?.playlists;
  if (!Array.isArray(playlists) || playlists.some((entry) => typeof entry !== "string")) {
    return NextResponse.json({ error: "playlists must be an array of names" }, { status: 400 });
  }
  if (playlists.length > MAX_PLAYLISTS) {
    return NextResponse.json({ error: `At most ${MAX_PLAYLISTS} playlists` }, { status: 400 });
  }
  const stored = cleanPlaylists(playlists);
  await mergeDashboardPreferences({ appleTV: { playlists: stored } });
  void attributeControl(request, {
    service: "system",
    event: "apple-tv-playlists",
    summary: `${stored.length} Apple TV preset playlist(s) saved`,
    detail: { route: "/api/appletv", count: stored.length, playlists: stored.join(" | ") },
  });
  // Read back rather than echoing the request: the dial draws what landed.
  return NextResponse.json({ playlists: storedPlaylists((await readDashboardPreferences()).appleTV?.playlists) });
}
