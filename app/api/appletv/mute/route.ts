import { NextResponse } from "next/server";
import { readDashboardConfig } from "../../../../lib/dashboard-config";
import { callService } from "../../../../lib/ha/client";
import { attributeControl } from "../../../../lib/control-attribution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The dial's mute, through the Apple TV (Adeline, 2026-09-22).
 *
 * The Apple TV cannot be asked to mute: it reports `SetVolume` and
 * `VolumeUp`/`VolumeDown` and **no** `VolumeMute`. So muting is `volume_set 0`
 * and unmuting is the level the dashboard was holding — asked which way to go,
 * Adeline chose that over leaving the dial's mute unwired, accepting that the
 * number restored is the dashboard's rather than the amplifier's. Nothing reads
 * the Apple TV's level back (`volume_level` is absent, so the `Volume` feature
 * is unsupported), so there is no other honest number to restore.
 *
 * `level` is the dial's own 0–100 reading; Home Assistant takes 0–1. The
 * amplifier's *own* volume remains the IR emitter's job
 * (`specs/apple-tv-volume.md`).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const record = body as { level?: unknown; muted?: unknown } | null;
  if (
    typeof record?.muted !== "boolean" ||
    typeof record.level !== "number" ||
    !Number.isFinite(record.level) ||
    record.level < 0 ||
    record.level > 100
  ) {
    return NextResponse.json(
      { error: "expected { muted: boolean, level: 0-100 }" },
      { status: 400 },
    );
  }

  const entityId = (await readDashboardConfig()).power?.ampPowerControl?.sourceEntityId;
  if (!entityId) {
    return NextResponse.json(
      { error: "No Apple TV is configured (power.ampPowerControl.sourceEntityId)" },
      { status: 503 },
    );
  }

  const percent = record.muted ? 0 : Math.round(record.level);
  try {
    await callService("media_player", "volume_set", { entity_id: entityId, volume_level: percent / 100 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not set the mute" },
      { status: 502 },
    );
  }

  void attributeControl(request, {
    service: "system",
    event: "apple-tv-mute",
    summary: percent === 0 ? "Apple TV muted" : `Apple TV unmuted at ${percent}%`,
    detail: { route: "/api/appletv/mute", entity: entityId, muted: percent === 0, level: percent },
  });
  return NextResponse.json({ entity: entityId, level: percent, muted: percent === 0 });
}
