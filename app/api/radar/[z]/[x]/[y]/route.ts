import { readDashboardConfig } from "../../../../../../lib/dashboard-config";
import { latestRadarFrame, transparentTile } from "../../../../../../lib/radar/store";
import { parseMode, parseRgbColor, parseTilePart, tileResponse, validTile } from "../../../../../../lib/radar/tile-model";
import { radarTileUrl, recolorRadarTile } from "../../../../../../lib/radar/recolor";
import type { RadarTileParams } from "../../../../../../lib/radar/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<RadarTileParams> }) {
  const config = await readDashboardConfig();
  const { x: rawX, y: rawY, z: rawZ } = await params;
  const x = parseTilePart(rawX);
  const y = parseTilePart(rawY);
  const z = parseTilePart(rawZ);

  if (!validTile(z, x, y)) {
    return new Response("Invalid radar tile", { status: 400 });
  }

  const frame = await latestRadarFrame(config.mapWeather.radar.manifestUrl, config.mapWeather.radar.fallbackHost);
  if (!frame) {
    return tileResponse(await transparentTile());
  }

  try {
    const radarResponse = await fetch(radarTileUrl(frame, z, x, y), { cache: "no-store" });
    if (!radarResponse.ok) {
      return tileResponse(await transparentTile());
    }

    const sourceBuffer = new Uint8Array(await radarResponse.arrayBuffer());
    const url = new URL(request.url);
    if (parseMode(url.searchParams.get("mode")) !== "custom") {
      return tileResponse(sourceBuffer);
    }

    const lowColor = parseRgbColor(url.searchParams.get("low"), [40, 243, 255]);
    const highColor = parseRgbColor(url.searchParams.get("high"), [255, 255, 255]);
    return tileResponse(await recolorRadarTile(sourceBuffer, lowColor, highColor));
  } catch (error) {
    console.warn("Failed to fetch radar tile", { error, x, y, z });
    return tileResponse(await transparentTile());
  }
}
