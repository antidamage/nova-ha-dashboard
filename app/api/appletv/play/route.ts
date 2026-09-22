import { NextResponse } from "next/server";
import { readDashboardConfig } from "../../../../lib/dashboard-config";
import { callService, haRest } from "../../../../lib/ha/client";
import { readDashboardPreferences } from "../../../../lib/preferences";
import { attributeControl } from "../../../../lib/control-attribution";
import { storedPlaylists, type AppleTVRepeatMode } from "../../../../lib/apple-tv/playlists";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The Music app's bundle id, which is how it is launched without depending on
 * the name the app list happens to use ("Music" in this house's HA, and
 * something else wherever the television is set to another language).
 */
const MUSIC_APP = "com.apple.TVMusic";

/** How long a sleeping Apple TV gets to wake before the rest of the sequence. */
const WAKE_TIMEOUT_MS = 20_000;

/**
 * What pyatv's repeat state is called, from the preset's own vocabulary. The
 * television has no "endless" mode to ask for — pyatv knows off, all and track —
 * so the endless preset repeats its playlist, which is the same instruction to
 * keep playing rather than stop at the end.
 */
const REPEAT_STATE: Record<AppleTVRepeatMode, "off" | "all"> = { off: "off", all: "all", infinite: "all" };

/**
 * Play one of the dial's presets on the Apple TV (Adeline, 2026-09-22) — the
 * one-shot event a preset button fires.
 *
 * It wakes the television, brings the Music app forward, applies the preset's
 * shuffle and repeat, and starts playback. **It cannot choose the playlist**:
 * HA's `apple_tv` integration is pyatv, which drives the Music app's transport
 * and reads its metadata but has no view of the library, and the Music app
 * registers no URL scheme to deep-link into a playlist — both the `https://`
 * and the `music://` form were sent to the real device and did nothing. So the
 * press resumes what Music has queued, wearing the preset's own settings, and
 * the routes that would make the playlist itself selectable are named in
 * `specs/apple-tv-volume.md`.
 *
 * The entity comes from the household config's amp control
 * (`power.ampPowerControl.sourceEntityId`) rather than from this file: the
 * Apple TV is this house's, and product code names no device.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const index = (body as { index?: unknown } | null)?.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "index must be a preset position" }, { status: 400 });
  }

  const entityId = (await readDashboardConfig()).power?.ampPowerControl?.sourceEntityId;
  if (!entityId) {
    return NextResponse.json(
      { error: "No Apple TV is configured (power.ampPowerControl.sourceEntityId)" },
      { status: 503 },
    );
  }

  const preset = storedPlaylists((await readDashboardPreferences()).appleTV?.playlists)[index];
  if (!preset) {
    return NextResponse.json({ error: "No preset at that position" }, { status: 400 });
  }

  try {
    await wake(entityId);
    await callService("media_player", "play_media", {
      entity_id: entityId,
      media_content_type: "app",
      media_content_id: MUSIC_APP,
    });
    await callService("media_player", "shuffle_set", { entity_id: entityId, shuffle: preset.shuffle });
    await callService("media_player", "repeat_set", { entity_id: entityId, repeat: REPEAT_STATE[preset.repeat] });
    await callService("media_player", "media_play", { entity_id: entityId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not play the preset" },
      { status: 502 },
    );
  }

  void attributeControl(request, {
    service: "system",
    event: "apple-tv-play",
    summary: `Apple TV preset ${preset.name} played`,
    detail: {
      route: "/api/appletv/play",
      entity: entityId,
      preset: preset.name,
      shuffle: preset.shuffle,
      repeat: preset.repeat,
    },
  });
  return NextResponse.json({ entity: entityId, name: preset.name, shuffle: preset.shuffle, repeat: preset.repeat });
}

/**
 * Turn the television on, and wait for it: the Companion wake is a request, not
 * a state change, and launching an app into a still-sleeping device is lost
 * silently. A device that is already awake costs one read.
 */
async function wake(entityId: string) {
  const state = async () => {
    const entity = await haRest<{ state?: unknown }>(`/api/states/${entityId}`);
    return typeof entity?.state === "string" ? entity.state : "";
  };
  const asleep = (value: string) => value === "off" || value === "standby";
  if (!asleep(await state())) return;

  await callService("media_player", "turn_on", { entity_id: entityId });
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (!asleep(await state())) return;
  }
  // Not awake within the window: the sequence that follows is still worth
  // attempting, so this is not an error — the app launch simply may not land.
}
