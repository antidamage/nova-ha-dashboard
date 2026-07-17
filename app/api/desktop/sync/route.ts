import { NextResponse } from "next/server";
import {
  queueManagedDesktopWallpaperSync,
  syncManagedDesktopWallpapers,
} from "../../../../lib/managed-desktop-sync";
import { readDashboardPreferences } from "../../../../lib/preferences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { force?: unknown };
    // Only the manual "Apply" action forces a re-send. Automatic triggers run
    // the deduplicated path so an unchanged wallpaper is never sent twice.
    const force = body?.force === true;
    const preferences = await readDashboardPreferences();

    // The manual button waits so it can report per-machine results. Automatic
    // triggers (leaving config, dark/light flip) must NOT block: copying a
    // wallpaper over SSH takes seconds, and the user is mid theme-change. We
    // return immediately and let the queue push in the background, so the rest
    // of the theme change never waits on the desktop image send.
    if (!force) {
      void queueManagedDesktopWallpaperSync(preferences.theme).catch((error) => {
        console.error("[managed-desktop] background wallpaper sync failed", error);
      });
      return NextResponse.json({ ok: true, queued: true });
    }

    const results = await syncManagedDesktopWallpapers(preferences.theme, { force: true });
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync managed desktops" },
      { status: 400 },
    );
  }
}
