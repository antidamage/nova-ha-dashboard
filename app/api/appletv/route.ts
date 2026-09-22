import { NextResponse } from "next/server";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";
import { attributeControl } from "../../../lib/control-attribution";
import { MAX_PLAYLISTS, cleanPlaylistName, cleanPlaylists, storedPlaylists } from "../../../lib/apple-tv/playlists";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The amplifier dial's playlist presets (Adeline, 2026-09-22).
 *
 * The dial is the placeholder for the IR emitter that will drive the amp, so
 * this route carries no volume and no mute — only the presets its buttons
 * offer: the Apple Music playlist each one plays, the icon its button wears and
 * how it should be played. There is no playlist endpoint on the Apple TV to
 * read from yet, so the list is typed in rather than fetched, and it lives in
 * the dashboard's own preferences.
 *
 * The list is always written whole and normalised on the way in: bounds,
 * duplicates, an icon this build does not ship and a playback type it does not
 * know are the server's business, so a second client cannot store a list the
 * dial cannot draw. An entry carrying no name at all is **refused** rather than
 * dropped — the dial would lose that button while the request answered 200 —
 * while a list of bare names is accepted as presets with nothing set, which is
 * how the shipped default file stores them.
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
  /**
   * Every entry must carry a name: a bare name, or a preset object with one.
   * Anything else is refused rather than dropped, because the list is written
   * whole — a body the dial could not draw in full is a client bug, and
   * answering 200 to it would empty the preset row silently. (`cleanPlaylists`
   * still drops blanks and unnameable entries, which is what a file written
   * before this shape needs.)
   */
  const named = (entry: unknown) =>
    typeof entry === "string"
      ? Boolean(cleanPlaylistName(entry))
      : Boolean(entry && typeof entry === "object" && cleanPlaylistName((entry as { name?: unknown }).name));
  if (!Array.isArray(playlists) || !playlists.every(named)) {
    return NextResponse.json({ error: "playlists must be an array of names or presets, each with a name" }, { status: 400 });
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
    detail: {
      route: "/api/appletv",
      count: stored.length,
      playlists: stored.map((playlist) => playlist.name).join(" | "),
    },
  });
  // Read back rather than echoing the request: the dial draws what landed.
  return NextResponse.json({ playlists: storedPlaylists((await readDashboardPreferences()).appleTV?.playlists) });
}
