import { NextResponse } from "next/server";
import { writePlayResult } from "../../../../../lib/appletv-command";
import { readDashboardConfig } from "../../../../../lib/dashboard-config";
import { callService } from "../../../../../lib/ha/client";
import { MUSIC_APP } from "../../../../../lib/apple-tv/apps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * What the Apple TV's app did with the play command it was handed (Adeline,
 * 2026-09-22).
 *
 * The dashboard cannot start a named Apple Music playlist itself — HA's
 * `apple_tv` integration is pyatv, transport and metadata with no view of the
 * library — so the app reports the outcome here and the preset editor shows it.
 * Without that, a preset whose name does not match a library playlist would
 * only ever be silence.
 *
 * No `attributeControl`: this is the television answering the dashboard, not a
 * person touching a control (specs/kiosk-attribution.md).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const record = body as { id?: unknown; name?: unknown; played?: unknown; reason?: unknown } | null;
  if (
    typeof record?.id !== "number" ||
    !Number.isFinite(record.id) ||
    typeof record.name !== "string" ||
    !record.name ||
    typeof record.played !== "boolean" ||
    (record.reason !== undefined && typeof record.reason !== "string")
  ) {
    return NextResponse.json(
      { error: "expected { id: number, name: string, played: boolean, reason?: string }" },
      { status: 400 },
    );
  }
  const result = await writePlayResult({
    id: record.id,
    name: record.name,
    played: record.played,
    reason: record.reason ?? null,
  });
  if (result.played) {
    // Deliberately not awaited: the answer belongs to the app's report, not to
    // the screen, and waiting on a Home Assistant round trip (the client's 8s)
    // outlasts the app's own 5s POST timeout, so it would hang up having never
    // seen the answer. Nothing is left unhandled by this — `showAppleMusic`
    // catches every path it has, config read included.
    void showAppleMusic();
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Put Apple Music on screen now that it is playing.
 *
 * Our own app is what started the playlist — it is where the MusicKit session
 * is — and its job is done by this point, so the Music app is brought forward
 * and the television shows Apple Music playing the playlist rather than the app
 * that launched it (Adeline, 2026-09-22: *"I don't wanna play them through the
 * app, can we play them through normal apple music on apple tv?"*).
 *
 * Best effort on purpose: the report has already landed, and nothing here may
 * turn the television's answer into a failure — a refused Home Assistant call,
 * or a config that cannot be read at all. Everything that can throw is inside
 * the try for that reason, the config read included.
 */
async function showAppleMusic() {
  try {
    const entityId = (await readDashboardConfig()).power?.ampPowerControl?.sourceEntityId;
    if (!entityId) return;
    await callService("media_player", "play_media", {
      entity_id: entityId,
      media_content_type: "app",
      media_content_id: MUSIC_APP,
    });
  } catch (error) {
    console.warn("[nova-dashboard] could not bring the Music app forward", error);
  }
}
