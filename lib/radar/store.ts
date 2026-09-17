// Sole owner of the radar route's module-level caches
// (specs/agent-token-footprint.md §4.2): the RainViewer manifest lookup and
// the transparent fallback tile.

import sharp from "sharp";
import { FALLBACK_RADAR_HOST, MANIFEST_CACHE_MS, MANIFEST_URL, TILE_SIZE } from "./constants";
import type { RadarFrame, RadarManifest } from "./types";

let latestRadarFrameCache: { at: number; frame: RadarFrame | null; manifestUrl: string } | null = null;
let transparentTilePromise: Promise<Uint8Array> | null = null;

export async function transparentTile() {
  if (!transparentTilePromise) {
    transparentTilePromise = sharp({
      create: {
        background: { alpha: 0, b: 0, g: 0, r: 0 },
        channels: 4,
        height: TILE_SIZE,
        width: TILE_SIZE,
      },
    })
      .png()
      .toBuffer()
      .then((buffer) => new Uint8Array(buffer));
  }

  return transparentTilePromise;
}

export async function latestRadarFrame(manifestUrl: string, fallbackHost: string) {
  if (
    latestRadarFrameCache &&
    latestRadarFrameCache.manifestUrl === manifestUrl &&
    Date.now() - latestRadarFrameCache.at < MANIFEST_CACHE_MS
  ) {
    return latestRadarFrameCache.frame;
  }

  try {
    const response = await fetch(manifestUrl || MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Manifest failed with ${response.status}`);
    }

    const manifest = await response.json() as RadarManifest;
    const latestFrame = manifest.radar?.past?.at(-1)?.path;
    const frame = latestFrame
      ? {
          host: (manifest.host ?? fallbackHost) || FALLBACK_RADAR_HOST,
          path: latestFrame,
        }
      : null;

    latestRadarFrameCache = {
      at: Date.now(),
      frame,
      manifestUrl,
    };

    return frame;
  } catch (error) {
    if (latestRadarFrameCache?.frame) {
      return latestRadarFrameCache.frame;
    }

    console.warn("Failed to refresh RainViewer manifest", { error });
    latestRadarFrameCache = {
      at: Date.now(),
      frame: null,
      manifestUrl,
    };
    return null;
  }
}
