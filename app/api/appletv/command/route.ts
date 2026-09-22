import { NextResponse } from "next/server";
import { readPendingPlayCommand } from "../../../../lib/appletv-command";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The play command the Apple TV's own app polls for (Adeline, 2026-09-22).
 *
 * `POST /api/appletv/play` leaves a command here and the Nova TV app — the only
 * place in this house with a MusicKit session — resolves the preset's name
 * against the Apple Music library and plays it. A command past its window is
 * not handed over at all, so a press made while the television was asleep
 * cannot start music when it next wakes; `specs/apple-tv-volume.md` §Play has
 * why the dashboard cannot do this itself.
 */
export async function GET() {
  return NextResponse.json(
    { command: await readPendingPlayCommand() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
