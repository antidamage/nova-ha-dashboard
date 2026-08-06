import { mkdir, readFile, readdir, rename, unlink, writeFile } from "fs/promises";
import path from "path";

/**
 * The centre-image library: transparent PNGs the visualiser can put in the
 * middle of the frame, in place of the centre message.
 *
 * Files on disk rather than data URLs in the configuration. A centre image is a
 * real 4K-capable picture, and the configuration blob is fetched whole by both
 * engines on every ETag change — carrying megabytes of base64 through it would
 * make every slider move re-ship the image. The configuration stores an id; the
 * engines fetch the bytes once, keyed by a cache-busted URL.
 *
 * The library is a history, not a single slot: uploads accumulate so a previous
 * image can be picked again, and entries are individually deletable. It is
 * capped, and the cap only ever evicts images nothing refers to.
 */

const IMAGES_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "phonoscope", "images");
const MANIFEST_PATH = path.join(IMAGES_DIR, "manifest.json");
const API_PATH = "/api/phonoscope/images";

const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 4096;

/**
 * How many uploads the history keeps. Old enough to have forgotten why you
 * uploaded something, small enough that the picker stays a picker.
 */
export const PHONOSCOPE_IMAGE_LIMIT = 20;

export type PhonoscopeImage = {
  id: string;
  name: string;
  width: number;
  height: number;
  size: number;
  /** True when the PNG can actually be transparent; see `readPng`. */
  hasAlpha: boolean;
  updatedAt: string;
};

export type PhonoscopeImageSummary = PhonoscopeImage & { url: string };

export function phonoscopeImageUrl(image: PhonoscopeImage) {
  return `${API_PATH}/${encodeURIComponent(image.id)}?v=${encodeURIComponent(image.updatedAt)}`;
}

export function maxPhonoscopeImageBytes() {
  const parsed = Number(process.env.NOVA_DASHBOARD_PHONOSCOPE_IMAGE_MAX_BYTES);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_IMAGE_BYTES;
  return Math.round(parsed);
}

/**
 * PNG only, sniffed from the signature rather than trusted from the upload's
 * declared type — the same rule `app/api/background-texture/route.ts` follows.
 *
 * Colour types 4 and 6 carry an alpha channel outright; type 3 is a palette,
 * which is transparent only if a tRNS chunk says so. An opaque PNG is accepted
 * rather than rejected: it still works, it just covers a rectangle, and telling
 * someone their logo is "invalid" when it renders fine would be wrong. The flag
 * rides along so the editor can point it out.
 */
export function readPng(data: Buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length < 26 || signature.some((byte, index) => data[index] !== byte)) return null;
  const colorType = data[25];
  const hasAlpha = colorType === 4 || colorType === 6
    || (colorType === 3 && data.includes(Buffer.from("tRNS", "ascii")));
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), hasAlpha };
}

function isImage(value: unknown): value is PhonoscopeImage {
  if (typeof value !== "object" || value === null) return false;
  const image = value as Partial<PhonoscopeImage>;
  return typeof image.id === "string" && typeof image.name === "string"
    && typeof image.width === "number" && typeof image.height === "number"
    && typeof image.size === "number" && typeof image.updatedAt === "string";
}

/** Newest first, which is the order the picker shows and eviction walks back. */
export async function readPhonoscopeImages(): Promise<PhonoscopeImage[]> {
  try {
    const parsed = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isImage)
      .map((image) => ({ ...image, hasAlpha: image.hasAlpha !== false }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [];
  }
}

export async function listPhonoscopeImages(): Promise<PhonoscopeImageSummary[]> {
  const images = await readPhonoscopeImages();
  return images.map((image) => ({ ...image, url: phonoscopeImageUrl(image) }));
}

/** `imageId -> fetchable URL`, for the engines, which never see the manifest. */
export async function phonoscopeImageUrls(): Promise<Record<string, string>> {
  const images = await readPhonoscopeImages();
  return Object.fromEntries(images.map((image) => [image.id, phonoscopeImageUrl(image)]));
}

async function writeManifest(images: PhonoscopeImage[]) {
  await mkdir(IMAGES_DIR, { recursive: true });
  // Written beside the target and renamed, so a crash mid-write cannot leave a
  // half-parsed manifest that loses the whole library.
  const temporary = `${MANIFEST_PATH}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(images, null, 2)}\n`, "utf8");
  await rename(temporary, MANIFEST_PATH);
}

function filePath(id: string) {
  return path.join(IMAGES_DIR, `${id}.png`);
}

/** Ids are generated here, so a filename can never come from an upload name. */
function newImageId() {
  return `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function readPhonoscopeImageFile(id: string) {
  // Belt and braces against a traversal in the route parameter: the id must be
  // exactly what `newImageId` produces.
  if (!/^[A-Za-z0-9_]+$/.test(id)) return null;
  try {
    return await readFile(filePath(id));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function savePhonoscopeImage(
  file: File,
  data: Buffer,
  /** Ids currently referenced by the configuration; never evicted. */
  inUse: Set<string>,
): Promise<PhonoscopeImageSummary> {
  const png = readPng(data);
  if (!png) throw new Error("The centre image must be a PNG");
  if (png.width > MAX_DIMENSION || png.height > MAX_DIMENSION) {
    throw new Error(`The centre image must be no larger than ${MAX_DIMENSION}px on either side`);
  }

  const image: PhonoscopeImage = {
    id: newImageId(),
    name: (file.name || "Centre image").slice(0, 120),
    width: png.width,
    height: png.height,
    size: data.byteLength,
    hasAlpha: png.hasAlpha,
    updatedAt: new Date().toISOString(),
  };

  await mkdir(IMAGES_DIR, { recursive: true });
  await writeFile(filePath(image.id), data);

  const existing = await readPhonoscopeImages();
  const next = [image, ...existing];
  // Evict from the oldest end, skipping anything the configuration still points
  // at: a colour theme's image disappearing because somebody uploaded twenty
  // others would be a data loss, not a cap.
  const evicted: PhonoscopeImage[] = [];
  while (next.length > PHONOSCOPE_IMAGE_LIMIT) {
    const index = next.map((entry, position) => ({ entry, position }))
      .reverse()
      .find(({ entry }) => !inUse.has(entry.id))?.position;
    if (index === undefined) break;
    evicted.push(...next.splice(index, 1));
  }

  await writeManifest(next);
  await Promise.allSettled(evicted.map((entry) => unlink(filePath(entry.id))));
  return { ...image, url: phonoscopeImageUrl(image) };
}

export async function deletePhonoscopeImage(id: string) {
  const existing = await readPhonoscopeImages();
  if (!existing.some((image) => image.id === id)) return false;
  await writeManifest(existing.filter((image) => image.id !== id));
  try {
    await unlink(filePath(id));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return true;
}

/** Orphans left behind by a manual edit of the data directory. */
export async function pruneOrphanedPhonoscopeImages() {
  const known = new Set((await readPhonoscopeImages()).map((image) => `${image.id}.png`));
  try {
    const entries = await readdir(IMAGES_DIR);
    await Promise.allSettled(entries
      .filter((entry) => entry.endsWith(".png") && !known.has(entry))
      .map((entry) => unlink(path.join(IMAGES_DIR, entry))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
