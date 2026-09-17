import { MAX_ZOOM, TILE_CACHE_CONTROL } from "./constants";

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function parseTilePart(value: string) {
  return Number(value.replace(/\.png$/, ""));
}

export function validTile(z: number, x: number, y: number) {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || z > MAX_ZOOM) {
    return false;
  }

  const tileCount = 2 ** z;
  return x >= 0 && x < tileCount && y >= 0 && y < tileCount;
}

export function parseRgbColor(value: string | null, fallback: readonly [number, number, number]): [number, number, number] {
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

export function parseMode(value: string | null) {
  return value === "custom" ? "custom" : "spectrum";
}

export function mixColor(low: [number, number, number], high: [number, number, number], amount: number) {
  return [
    Math.round(low[0] + (high[0] - low[0]) * amount),
    Math.round(low[1] + (high[1] - low[1]) * amount),
    Math.round(low[2] + (high[2] - low[2]) * amount),
  ] as const;
}

export function tileResponse(body: Uint8Array, status = 200) {
  return new Response(new Uint8Array(body).buffer, {
    status,
    headers: {
      "Cache-Control": TILE_CACHE_CONTROL,
      "Content-Type": "image/png",
    },
  });
}
