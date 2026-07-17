import { mkdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TEXTURE_API_PATH = "/api/background-texture";
const DEFAULT_MAX_TEXTURE_BYTES = 8 * 1024 * 1024;
const TEXTURE_PATH = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "background-texture");
const TEXTURE_METADATA_PATH = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "background-texture.json");

type BackgroundTextureMetadata = {
  contentType: string;
  height: number;
  name: string;
  size: number;
  updatedAt: string;
  width: number;
};

type DetectedTexture = {
  contentType: string;
  height: number;
  width: number;
};

function texturePath() {
  return TEXTURE_PATH;
}

function metadataPath() {
  return TEXTURE_METADATA_PATH;
}

function maxTextureBytes() {
  const parsed = Number(process.env.NOVA_DASHBOARD_BACKGROUND_TEXTURE_MAX_BYTES);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_TEXTURE_BYTES;
  }
  return Math.round(parsed);
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

    const isStartOfFrame = (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    );
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

function detectTexture(data: Buffer): DetectedTexture | null {
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

function textureUrl(updatedAt?: string) {
  return `${TEXTURE_API_PATH}${updatedAt ? `?v=${encodeURIComponent(updatedAt)}` : ""}`;
}

function statusFromMetadata(metadata: BackgroundTextureMetadata) {
  return {
    contentType: metadata.contentType,
    exists: true,
    height: metadata.height,
    name: metadata.name,
    size: metadata.size,
    updatedAt: metadata.updatedAt,
    url: textureUrl(metadata.updatedAt),
    width: metadata.width,
  };
}

async function readTextureMetadata(): Promise<BackgroundTextureMetadata | null> {
  try {
    const metadata = JSON.parse(await readFile(metadataPath(), "utf8")) as Partial<BackgroundTextureMetadata>;
    if (
      typeof metadata.contentType === "string" &&
      typeof metadata.height === "number" &&
      typeof metadata.name === "string" &&
      typeof metadata.size === "number" &&
      typeof metadata.updatedAt === "string" &&
      typeof metadata.width === "number"
    ) {
      return metadata as BackgroundTextureMetadata;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  try {
    const details = await stat(texturePath());
    return {
      contentType: "image/png",
      height: 0,
      name: "Background texture",
      size: details.size,
      updatedAt: details.mtime.toISOString(),
      width: 0,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function textureStatus() {
  const metadata = await readTextureMetadata();
  return metadata ? statusFromMetadata(metadata) : { exists: false };
}

function textureHeaders(size: number, contentType: string) {
  return {
    "Cache-Control": "no-store",
    "Content-Length": String(size),
    "Content-Type": contentType,
  };
}

async function deleteTextureFile() {
  const results = await Promise.allSettled([
    unlink(texturePath()),
    unlink(metadataPath()),
  ]);
  const failed = results.find((result) =>
    result.status === "rejected" && (result.reason as NodeJS.ErrnoException).code !== "ENOENT"
  );
  if (failed?.status === "rejected") {
    throw failed.reason;
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("status") === "1") {
      return NextResponse.json(await textureStatus());
    }

    const data = await readFile(texturePath());
    const metadata = await readTextureMetadata();
    return new NextResponse(data, {
      headers: textureHeaders(data.byteLength, metadata?.contentType ?? "image/png"),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "No background texture has been uploaded" }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read background texture" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new Error("Image texture file is required");
    }
    if (file.size <= 0 || file.size > maxTextureBytes()) {
      throw new Error(`Image texture must be between 1 byte and ${Math.round(maxTextureBytes() / 1024 / 1024)} MB`);
    }

    const data = Buffer.from(await file.arrayBuffer());
    const detected = detectTexture(data);
    if (!detected) {
      throw new Error("Image texture must be a PNG, JPEG, or WebP image");
    }

    const updatedAt = new Date().toISOString();
    const textureMetadata: BackgroundTextureMetadata = {
      contentType: detected.contentType,
      height: detected.height,
      name: file.name || "Background texture",
      size: data.byteLength,
      updatedAt,
      width: detected.width,
    };
    const targetPath = texturePath();
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, data);
    await writeFile(metadataPath(), `${JSON.stringify(textureMetadata, null, 2)}\n`, "utf8");

    return NextResponse.json(statusFromMetadata(textureMetadata));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload background texture" },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  try {
    await deleteTextureFile();
    return NextResponse.json({ exists: false });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to remove background texture" },
      { status: 400 },
    );
  }
}
