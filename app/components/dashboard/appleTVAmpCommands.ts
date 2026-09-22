"use client";

/**
 * The two one-shot commands the amplifier dial sends (Adeline, 2026-09-22).
 *
 * Both go to the dashboard's own routes, which is where the Home Assistant
 * service calls and the household config live; this module is only the browser
 * end of them, so the store keeps the state and the error line while these stay
 * one function per command. Their own module because the store is close to the
 * repo's file-size cap (specs/agent-token-footprint.md).
 *
 * Each answers the message to show, or null when the command landed.
 */

const PLAY = "/api/appletv/play";
const MUTE = "/api/appletv/mute";

async function post(path: string, body: Record<string, unknown>, fallback: string): Promise<string | null> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return null;
    const payload = await response.json().catch(() => ({})) as { error?: string };
    return payload.error ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Fire a preset's play event: the route wakes the Apple TV, brings our own app
 * forward and leaves it the playlist's name to resolve
 * (`specs/apple-tv-volume.md` §Play).
 */
export function sendPresetPlay(index: number): Promise<string | null> {
  return post(PLAY, { index }, "Could not play the preset");
}

/**
 * Mute or unmute through the Apple TV. It has no mute of its own, so this is
 * `volume_set 0` and, coming back, the level the dial is holding.
 */
export function sendAmpMute(level: number, muted: boolean): Promise<string | null> {
  return post(MUTE, { level, muted }, "Could not set the mute");
}
