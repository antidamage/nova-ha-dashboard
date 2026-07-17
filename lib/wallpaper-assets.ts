import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export const WALLPAPER_ASSET_MAX_BYTES = 24 * 1024 * 1024;

const WALLPAPER_DIR =
  process.env.NOVA_DESKTOP_WALLPAPER_DIR ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "wallpapers");
const WALLPAPER_INDEX_PATH =
  process.env.NOVA_DESKTOP_WALLPAPER_INDEX ??
  path.join(WALLPAPER_DIR, "index.json");

export type WallpaperAsset = {
  contentType: "image/png" | "image/jpeg" | "image/webp";
  createdAt: string;
  height: number;
  id: string;
  name: string;
  size: number;
  updatedAt: string;
  width: number;
};

type WallpaperAssetIndex = {
  assets: WallpaperAsset[];
  version: 1;
};

type DetectedImage = Pick<WallpaperAsset, "contentType" | "height" | "width">;

let writeQueue = Promise.resolve();

function wallpaperFilePath(id: string) {
  return path.join(WALLPAPER_DIR, "assets", id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isWallpaperAssetId(value: unknown): value is string {
  return typeof value === "string" && /^wallpaper_[a-f0-9-]{36}$/.test(value);
}

export function wallpaperAssetUrl(asset: WallpaperAsset) {
  return `/api/desktop/wallpapers/${asset.id}?v=${encodeURIComponent(asset.updatedAt)}`;
}

function uint24Le(data: Buffer, offset: number) {
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
}

function jpegDimensions(data: Buffer) {
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = data[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0x01) {
      continue;
    }
    if (marker === 0xd9 || marker === 0xda || offset + 2 > data.length) {
      break;
    }

    const segmentLength = data.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > data.length) {
      break;
    }

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && segmentLength >= 7) {
      return {
        height: data.readUInt16BE(offset + 3),
        width: data.readUInt16BE(offset + 5),
      };
    }

    offset += segmentLength;
  }

  return { height: 0, width: 0 };
}

function webpDimensions(data: Buffer) {
  if (data.length < 30) {
    return { height: 0, width: 0 };
  }

  const chunk = data.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return {
      height: uint24Le(data, 27) + 1,
      width: uint24Le(data, 24) + 1,
    };
  }

  if (chunk === "VP8L" && data[20] === 0x2f) {
    return {
      height: 1 + (((data[24] & 0x0f) << 10) | (data[23] << 2) | ((data[22] & 0xc0) >> 6)),
      width: 1 + (((data[22] & 0x3f) << 8) | data[21]),
    };
  }

  if (chunk === "VP8 " && data.length >= 30 && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
    return {
      height: data.readUInt16LE(28) & 0x3fff,
      width: data.readUInt16LE(26) & 0x3fff,
    };
  }

  return { height: 0, width: 0 };
}

export function detectWallpaperImage(data: Buffer): DetectedImage | null {
  if (
    data.length >= 24 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return {
      contentType: "image/png",
      height: data.readUInt32BE(20),
      width: data.readUInt32BE(16),
    };
  }

  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9) {
    return {
      contentType: "image/jpeg",
      ...jpegDimensions(data),
    };
  }

  if (data.length >= 16 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return {
      contentType: "image/webp",
      ...webpDimensions(data),
    };
  }

  return null;
}

function normalizeAsset(value: unknown): WallpaperAsset | null {
  if (!isRecord(value) || !isWallpaperAssetId(value.id)) {
    return null;
  }
  const contentType = value.contentType === "image/jpeg" || value.contentType === "image/webp"
    ? value.contentType
    : "image/png";
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : createdAt;
  return {
    contentType,
    createdAt,
    height: Math.max(0, Math.round(Number(value.height ?? 0))),
    id: value.id,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, 160) : "Desktop wallpaper",
    size: Math.max(0, Math.round(Number(value.size ?? 0))),
    updatedAt,
    width: Math.max(0, Math.round(Number(value.width ?? 0))),
  };
}

async function readIndex(): Promise<WallpaperAssetIndex> {
  try {
    const value = JSON.parse(await readFile(WALLPAPER_INDEX_PATH, "utf8")) as unknown;
    const assets = isRecord(value) && Array.isArray(value.assets)
      ? value.assets.map(normalizeAsset).filter((asset): asset is WallpaperAsset => Boolean(asset))
      : [];
    return { version: 1, assets };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, assets: [] };
    }
    throw error;
  }
}

async function writeIndex(index: WallpaperAssetIndex) {
  await mkdir(path.dirname(WALLPAPER_INDEX_PATH), { recursive: true });
  const tempPath = `${WALLPAPER_INDEX_PATH}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await rename(tempPath, WALLPAPER_INDEX_PATH);
}

export async function listWallpaperAssets() {
  return (await readIndex()).assets;
}

export async function uploadWallpaperAsset(input: { data: Buffer; name?: string }) {
  if (input.data.byteLength <= 0 || input.data.byteLength > WALLPAPER_ASSET_MAX_BYTES) {
    throw new Error(`Wallpaper image must be between 1 byte and ${Math.round(WALLPAPER_ASSET_MAX_BYTES / 1024 / 1024)} MB`);
  }

  const detected = detectWallpaperImage(input.data);
  if (!detected) {
    throw new Error("Wallpaper image must be a PNG, JPEG, or WebP image");
  }

  const now = new Date().toISOString();
  const asset: WallpaperAsset = {
    ...detected,
    createdAt: now,
    id: `wallpaper_${randomUUID()}`,
    name: input.name?.trim().slice(0, 160) || "Desktop wallpaper",
    size: input.data.byteLength,
    updatedAt: now,
  };

  writeQueue = writeQueue.then(async () => {
    await mkdir(path.dirname(wallpaperFilePath(asset.id)), { recursive: true });
    await writeFile(wallpaperFilePath(asset.id), input.data);
    const index = await readIndex();
    await writeIndex({ version: 1, assets: [...index.assets.filter((item) => item.id !== asset.id), asset] });
  });

  await writeQueue;
  return asset;
}

export async function readWallpaperAssetFile(id: string) {
  if (!isWallpaperAssetId(id)) {
    throw new Error("Invalid wallpaper asset id");
  }
  const asset = (await listWallpaperAssets()).find((item) => item.id === id);
  if (!asset) {
    throw Object.assign(new Error("Wallpaper asset not found"), { code: "ENOENT" });
  }
  const filePath = wallpaperFilePath(id);
  return {
    asset,
    data: await readFile(filePath),
    filePath,
  };
}

export async function removeWallpaperAsset(id: string) {
  if (!isWallpaperAssetId(id)) {
    throw new Error("Invalid wallpaper asset id");
  }

  writeQueue = writeQueue.then(async () => {
    const index = await readIndex();
    await writeIndex({ version: 1, assets: index.assets.filter((item) => item.id !== id) });
    try {
      await unlink(wallpaperFilePath(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  });

  await writeQueue;
  return { assets: await listWallpaperAssets() };
}
