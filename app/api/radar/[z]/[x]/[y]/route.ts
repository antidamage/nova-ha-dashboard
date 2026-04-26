import sharp from "sharp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MANIFEST_URL = "https://api.rainviewer.com/public/weather-maps.json";
const MANIFEST_CACHE_MS = 4 * 60 * 1000;
const TILE_CACHE_CONTROL = "public, max-age=240, stale-while-revalidate=600";
const TILE_SIZE = 256;
const MAX_ZOOM = 7;
const FALLBACK_RADAR_HOST = "https://tilecache.rainviewer.com";
const RADAR_COLOR_TABLE = [
  { dbz: -10, rgba: "#63615914" },
  { dbz: -9, rgba: "#66635a19" },
  { dbz: -8, rgba: "#69665c1e" },
  { dbz: -7, rgba: "#6c685d24" },
  { dbz: -6, rgba: "#6f6b5f29" },
  { dbz: -5, rgba: "#726e612e" },
  { dbz: -4, rgba: "#75706234" },
  { dbz: -3, rgba: "#78736439" },
  { dbz: -2, rgba: "#7c75653e" },
  { dbz: -1, rgba: "#7f786744" },
  { dbz: 0, rgba: "#827b6949" },
  { dbz: 1, rgba: "#857d6a4e" },
  { dbz: 2, rgba: "#88806c54" },
  { dbz: 3, rgba: "#8b826d59" },
  { dbz: 4, rgba: "#8e856f5e" },
  { dbz: 5, rgba: "#92887164" },
  { dbz: 6, rgba: "#9e93756e" },
  { dbz: 7, rgba: "#aa9e7978" },
  { dbz: 8, rgba: "#b6a97e82" },
  { dbz: 9, rgba: "#c2b4828c" },
  { dbz: 10, rgba: "#cec08796" },
  { dbz: 11, rgba: "#d2c48ba0" },
  { dbz: 12, rgba: "#d6c88faa" },
  { dbz: 13, rgba: "#dacc93b4" },
  { dbz: 14, rgba: "#ded097be" },
  { dbz: 15, rgba: "#88ddeeff" },
  { dbz: 16, rgba: "#6cd1ebff" },
  { dbz: 17, rgba: "#51c5e8ff" },
  { dbz: 18, rgba: "#36bae5ff" },
  { dbz: 19, rgba: "#1baee2ff" },
  { dbz: 20, rgba: "#00a3e0ff" },
  { dbz: 21, rgba: "#009ad5ff" },
  { dbz: 22, rgba: "#0091caff" },
  { dbz: 23, rgba: "#0088bfff" },
  { dbz: 24, rgba: "#007fb4ff" },
  { dbz: 25, rgba: "#0077aaff" },
  { dbz: 26, rgba: "#0070a3ff" },
  { dbz: 27, rgba: "#00699cff" },
  { dbz: 28, rgba: "#006295ff" },
  { dbz: 29, rgba: "#005b8eff" },
  { dbz: 30, rgba: "#005588ff" },
  { dbz: 31, rgba: "#005180ff" },
  { dbz: 32, rgba: "#004e78ff" },
  { dbz: 33, rgba: "#004a70ff" },
  { dbz: 34, rgba: "#004768ff" },
  { dbz: 35, rgba: "#ffee00ff" },
  { dbz: 36, rgba: "#ffe000ff" },
  { dbz: 37, rgba: "#ffd200ff" },
  { dbz: 38, rgba: "#ffc500ff" },
  { dbz: 39, rgba: "#ffb700ff" },
  { dbz: 40, rgba: "#ffaa00ff" },
  { dbz: 41, rgba: "#ff9f00ff" },
  { dbz: 42, rgba: "#ff9500ff" },
  { dbz: 43, rgba: "#ff8b00ff" },
  { dbz: 44, rgba: "#ff8100ff" },
  { dbz: 45, rgba: "#ff4400ff" },
  { dbz: 46, rgba: "#f23600ff" },
  { dbz: 47, rgba: "#e62800ff" },
  { dbz: 48, rgba: "#d91b00ff" },
  { dbz: 49, rgba: "#cd0d00ff" },
  { dbz: 50, rgba: "#c10000ff" },
  { dbz: 51, rgba: "#a80000ff" },
  { dbz: 52, rgba: "#8f0000ff" },
  { dbz: 53, rgba: "#760000ff" },
  { dbz: 54, rgba: "#5d0000ff" },
  { dbz: 55, rgba: "#ffaaffff" },
  { dbz: 56, rgba: "#ff9fffff" },
  { dbz: 57, rgba: "#ff95ffff" },
  { dbz: 58, rgba: "#ff8bffff" },
  { dbz: 59, rgba: "#ff81ffff" },
  { dbz: 60, rgba: "#ff77ffff" },
  { dbz: 61, rgba: "#ff6cffff" },
  { dbz: 62, rgba: "#ff62ffff" },
  { dbz: 63, rgba: "#ff58ffff" },
  { dbz: 64, rgba: "#ff4effff" },
  { dbz: 65, rgba: "#ffffffff" },
  { dbz: 75, rgba: "#00ff00ff" },
] as const;

type RadarTileParams = {
  x: string;
  y: string;
  z: string;
};

type RadarManifest = {
  host?: string;
  radar?: {
    past?: Array<{
      path?: string;
      time?: number;
    }>;
  };
};

type RadarFrame = {
  host: string;
  path: string;
};

let latestRadarFrameCache: { at: number; frame: RadarFrame | null } | null = null;
let transparentTilePromise: Promise<Uint8Array> | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseTilePart(value: string) {
  return Number(value.replace(/\.png$/, ""));
}

function validTile(z: number, x: number, y: number) {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || z > MAX_ZOOM) {
    return false;
  }

  const tileCount = 2 ** z;
  return x >= 0 && x < tileCount && y >= 0 && y < tileCount;
}

function parseRgbColor(value: string | null, fallback: readonly [number, number, number]): [number, number, number] {
  if (!value) {
    return [fallback[0], fallback[1], fallback[2]] as [number, number, number];
  }

  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) {
    return [fallback[0], fallback[1], fallback[2]] as [number, number, number];
  }

  return [
    clamp(Math.round(parts[0]), 0, 255),
    clamp(Math.round(parts[1]), 0, 255),
    clamp(Math.round(parts[2]), 0, 255),
  ];
}

function parseMode(value: string | null) {
  return value === "custom" ? "custom" : "spectrum";
}

function hexToChannels(value: string) {
  const hex = value.replace("#", "");
  return {
    a: Number.parseInt(hex.slice(6, 8), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    r: Number.parseInt(hex.slice(0, 2), 16),
  };
}

function packRgba(r: number, g: number, b: number, a: number) {
  return (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
}

function normalizeRadarIntensity(dbz: number) {
  return clamp((Math.min(dbz, 65) + 10) / 75, 0, 1);
}

const radarPaletteStops = RADAR_COLOR_TABLE.map(({ dbz, rgba }) => {
  const channels = hexToChannels(rgba);
  return {
    ...channels,
    intensity: normalizeRadarIntensity(dbz),
    packed: packRgba(channels.r, channels.g, channels.b, channels.a),
  };
});

const radarIntensityByPackedRgba = new Map(radarPaletteStops.map((stop) => [stop.packed, stop.intensity]));

function radarIntensityForPixel(r: number, g: number, b: number, a: number) {
  if (a === 0) {
    return 0;
  }

  const exact = radarIntensityByPackedRgba.get(packRgba(r, g, b, a));
  if (exact !== undefined) {
    return exact;
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestIntensity = clamp(a / 255, 0, 1);

  for (const stop of radarPaletteStops) {
    const dr = r - stop.r;
    const dg = g - stop.g;
    const db = b - stop.b;
    const da = a - stop.a;
    const distance = dr * dr + dg * dg + db * db + da * da * 0.25;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIntensity = stop.intensity;
    }
  }

  return bestIntensity;
}

function mixColor(low: [number, number, number], high: [number, number, number], amount: number) {
  return [
    Math.round(low[0] + (high[0] - low[0]) * amount),
    Math.round(low[1] + (high[1] - low[1]) * amount),
    Math.round(low[2] + (high[2] - low[2]) * amount),
  ] as const;
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

async function transparentTile() {
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

async function latestRadarFrame() {
  if (latestRadarFrameCache && Date.now() - latestRadarFrameCache.at < MANIFEST_CACHE_MS) {
    return latestRadarFrameCache.frame;
  }

  try {
    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Manifest failed with ${response.status}`);
    }

    const manifest = await response.json() as RadarManifest;
    const latestFrame = manifest.radar?.past?.at(-1)?.path;
    const frame = latestFrame
      ? {
          host: manifest.host ?? FALLBACK_RADAR_HOST,
          path: latestFrame,
        }
      : null;

    latestRadarFrameCache = {
      at: Date.now(),
      frame,
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
    };
    return null;
  }
}

function radarTileUrl(frame: RadarFrame, z: number, x: number, y: number) {
  return `${frame.host}${frame.path}/${TILE_SIZE}/${z}/${x}/${y}/2/0_0.png`;
}

async function recolorRadarTile(buffer: Uint8Array, lowColor: [number, number, number], highColor: [number, number, number]) {
  const image = sharp(buffer);
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  for (let offset = 0; offset < data.length; offset += info.channels) {
    const alpha = data[offset + 3];
    if (alpha === 0) {
      continue;
    }

    const intensity = radarIntensityForPixel(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      alpha,
    );
    const [r, g, b] = mixColor(lowColor, highColor, intensity);
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
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

export async function GET(request: Request, { params }: { params: Promise<RadarTileParams> }) {
  const { x: rawX, y: rawY, z: rawZ } = await params;
  const x = parseTilePart(rawX);
  const y = parseTilePart(rawY);
  const z = parseTilePart(rawZ);

  if (!validTile(z, x, y)) {
    return new Response("Invalid radar tile", { status: 400 });
  }

  const frame = await latestRadarFrame();
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
