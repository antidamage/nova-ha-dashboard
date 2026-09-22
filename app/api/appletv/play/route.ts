import { NextResponse } from "next/server";
import { readDashboardConfig } from "../../../../lib/dashboard-config";
import { callService, haRest } from "../../../../lib/ha/client";
import { readDashboardPreferences } from "../../../../lib/preferences";
import { attributeControl } from "../../../../lib/control-attribution";
import { writePlayCommand } from "../../../../lib/appletv-command";
import { storedPlaylists, type AppleTVPlaylist, type AppleTVRepeatMode } from "../../../../lib/apple-tv/playlists";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Our own app on the television (`nova-appletv-dashboard`), which is the only
 * place in this house with a MusicKit session. Launched by bundle id rather
 * than by the name it happens to have in the app list.
 */
const NOVA_TV_APP = "nz.co.skull.NovaAppleTVDashboard";

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
 * It wakes the television, brings **our own app** forward, and leaves it a play
 * command (`lib/appletv-command.ts`). That app is what plays the named
 * playlist: it holds the MusicKit session, so it resolves the preset's name
 * against the Apple Music library and starts it through `SystemMusicPlayer` —
 * which is the Music app's own player, so playback carries on with our app in
 * the background and the phonoscope can visualise it.
 *
 * The dashboard cannot do that step itself, and the measurement is in
 * `specs/apple-tv-volume.md`: HA's `apple_tv` integration is pyatv, transport
 * and metadata with no view of the library, and the Music app answers no URL
 * scheme to deep-link into a playlist. So nothing here starts "whatever was
 * loaded" — when the app cannot find the playlist it plays nothing and says so,
 * because the wrong music is worse than silence.
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
      media_content_id: NOVA_TV_APP,
    });
    // Written after the launch, so the app is on screen and polling before the
    // command exists to be missed.
    const command = await writePlayCommand({ name: preset.name, repeat: preset.repeat, shuffle: preset.shuffle });
    await applyPlaybackModes(entityId, preset);

    void attributeControl(request, {
      service: "system",
      event: "apple-tv-play",
      summary: `Apple TV preset ${preset.name} requested`,
      detail: {
        route: "/api/appletv/play",
        entity: entityId,
        preset: preset.name,
        shuffle: preset.shuffle,
        repeat: preset.repeat,
        command: command.id,
      },
    });
    return NextResponse.json({
      entity: entityId,
      name: preset.name,
      shuffle: preset.shuffle,
      repeat: preset.repeat,
      command: command.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not play the preset" },
      { status: 502 },
    );
  }
}

/**
 * Turn the television on, and wait for it: the Companion wake is a request, not
 * a state change, and an app launched into a still-sleeping device is lost
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

/**
 * The Music app's shuffle and repeat, which the television holds as playback
 * modes rather than per-queue settings. Best effort on purpose: no queue exists
 * yet at the moment of the press — the app is still resolving the playlist —
 * and a refusal here must not be reported as a failed press.
 */
async function applyPlaybackModes(entityId: string, preset: AppleTVPlaylist) {
  const calls: Array<[string, Record<string, unknown>]> = [
    ["shuffle_set", { entity_id: entityId, shuffle: preset.shuffle }],
    ["repeat_set", { entity_id: entityId, repeat: REPEAT_STATE[preset.repeat] }],
  ];
  for (const [service, data] of calls) {
    try {
      await callService("media_player", service, data);
    } catch (error) {
      console.warn("[nova-dashboard] Apple TV playback mode not applied", { service, error });
    }
  }
}
