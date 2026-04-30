import sharp from "sharp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TILE_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";
const SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TILE_SIZE = 256;
const MAX_ZOOM = 19;
const DEFAULT_TINT_BRIGHTEN = 4.5;
const FALLBACK_TINT: [number, number, number] = [37, 39, 40];

type SatelliteTileParams = {
  x: string;
  y: string;
  z: string;
};

let blackTilePromise: Promise<Uint8Array> | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseTilePart(value: string) {
  return Number(value.replace(/\.(png|jpg|jpeg)$/i, ""));
}

function validTile(z: number, x: number, y: number) {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || z > MAX_ZOOM) {
    return false;
  }
  const tileCount = 2 ** z;
  return x >= 0 && x < tileCount && y >= 0 && y < tileCount;
}

function parseTint(value: string | null): [number, number, number] {
  if (!value) {
    return [...FALLBACK_TINT];
  }
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) {
    return [...FALLBACK_TINT];
  }
  return [
    clamp(Math.round(parts[0]), 0, 255),
    clamp(Math.round(parts[1]), 0, 255),
    clamp(Math.round(parts[2]), 0, 255),
  ];
}

function tileResponse(body: Uint8Array, status = 200) {
  return new Response(new Uint8Array(body).buffer, {
    status,
    headers: {
      "Cache-Control": TILE_CACHE_CONTROL,
      "Content-Type": "image/png",
    },
  });
}

async function blackTile() {
  if (!blackTilePromise) {
    blackTilePromise = sharp({
      create: {
        background: { alpha: 255, b: 0, g: 0, r: 0 },
        channels: 4,
        height: TILE_SIZE,
        width: TILE_SIZE,
      },
    })
      .png()
      .toBuffer()
      .then((buffer) => new Uint8Array(buffer));
  }
  return blackTilePromise;
}

function satelliteUpstreamUrl(z: number, x: number, y: number) {
  return SATELLITE_TILE_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

async function tintTile(buffer: Uint8Array, tint: [number, number, number], brighten: number) {
  const image = sharp(buffer);
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  // Brighten the tint so the resulting tile has visible mid-tones; the base
  // colour is typically very dark and needs a multiplier to read through the
  // luminance ramp.
  const tintR = clamp(tint[0] * brighten, 0, 255);
  const tintG = clamp(tint[1] * brighten, 0, 255);
  const tintB = clamp(tint[2] * brighten, 0, 255);

  for (let offset = 0; offset < data.length; offset += info.channels) {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    // BT.709 luminance, normalised to 0-1.
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    data[offset] = Math.round(tintR * luminance);
    data[offset + 1] = Math.round(tintG * luminance);
    data[offset + 2] = Math.round(tintB * luminance);
    // Force opaque — we want the tile to fully cover the base/landuse layers.
    data[offset + 3] = 255;
  }

  return sharp(data, {
    raw: {
      channels: info.channels,
      height: info.height,
      width: info.width,
    },
  })
    .png()
    .toBuffer()
    .then((nextBuffer) => new Uint8Array(nextBuffer));
}

export async function GET(request: Request, { params }: { params: Promise<SatelliteTileParams> }) {
  const { x: rawX, y: rawY, z: rawZ } = await params;
  const x = parseTilePart(rawX);
  const y = parseTilePart(rawY);
  const z = parseTilePart(rawZ);

  if (!validTile(z, x, y)) {
    return new Response("Invalid satellite tile", { status: 400 });
  }

  const url = new URL(request.url);
  const tint = parseTint(url.searchParams.get("base"));
  const brightenParam = Number(url.searchParams.get("brighten"));
  const brighten = Number.isFinite(brightenParam) && brightenParam > 0 ? brightenParam : DEFAULT_TINT_BRIGHTEN;

  try {
    const upstream = await fetch(satelliteUpstreamUrl(z, x, y), {
      cache: "no-store",
      headers: { "User-Agent": "nova-ha-dashboard/1.0" },
    });
    if (!upstream.ok) {
      return tileResponse(await blackTile());
    }
    const sourceBuffer = new Uint8Array(await upstream.arrayBuffer());
    return tileResponse(await tintTile(sourceBuffer, tint, brighten));
  } catch (error) {
    console.warn("Failed to fetch satellite tile", { error, x, y, z });
    return tileResponse(await blackTile());
  }
}
