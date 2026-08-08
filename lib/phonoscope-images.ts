import { mkdir, readFile, readdir, rename, unlink, writeFile } from "fs/promises";
import path from "path";

/**
 * The image libraries: pictures the visualiser can put in the middle of the
 * frame in place of the centre message, or behind the whole picture in place of
 * the procedural backdrop.
 *
 * TWO libraries, one per slot. They are different kinds of picture — a
 * transparent centrepiece and a full-bleed backdrop — and sharing one list put
 * every centre logo in the background picker, where it could not even be
 * deleted because the other slot's reference held it.
 *
 * The split is a `slot` on each entry rather than a second directory: the ids,
 * the serving route and `phonoscopeImageUrls` are what both engines consume, so
 * they stay exactly as they were and only the listing narrows.
 *
 * Files on disk rather than data URLs in the configuration. These are real
 * 4K-capable pictures, and the configuration blob is fetched whole by both
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

/**
 * Raised from 8 MB when the library stopped being logos only. A 4K photograph
 * is a normal background and a normal background is tens of megabytes as a PNG;
 * the old cap rejected most real ones.
 */
const DEFAULT_MAX_IMAGE_BYTES = 32 * 1024 * 1024;
/**
 * Raised from 4096 for the same reason: a 5K or 6K source downscaled to the
 * output is a reasonable thing to hand a 4K renderer, and refusing it forces a
 * resize outside Nova for no gain.
 */
const MAX_DIMENSION = 8192;

/**
 * How many uploads the history keeps, PER SLOT. Old enough to have forgotten
 * why you uploaded something, small enough that the picker stays a picker.
 */
export const PHONOSCOPE_IMAGE_LIMIT = 20;

/** Which picker an image belongs to. */
export type PhonoscopeImageSlot = "centre" | "background";

export const PHONOSCOPE_IMAGE_SLOTS: PhonoscopeImageSlot[] = ["centre", "background"];

export function phonoscopeImageSlot(value: unknown): PhonoscopeImageSlot {
  return value === "background" ? "background" : "centre";
}

/**
 * APPEND-ONLY, and stored per entry: the extension on disk is the format, so
 * renaming one orphans every file already written under the old name.
 */
export type PhonoscopeImageFormat = "png" | "jpeg" | "webp";

export const PHONOSCOPE_IMAGE_CONTENT_TYPES: Record<PhonoscopeImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export type PhonoscopeImage = {
  id: string;
  name: string;
  width: number;
  height: number;
  size: number;
  /** True when the file can actually be transparent; see `readImageHeader`. */
  hasAlpha: boolean;
  /**
   * Absent on entries written before the library accepted anything but PNG,
   * which is exactly how `filePath` knows those are still `.png` on disk.
   */
  format?: PhonoscopeImageFormat;
  /**
   * Which picker it appears in. Absent on entries written while there was one
   * shared library; `readPhonoscopeImages` resolves those from what the
   * configuration points at, so nothing has to be migrated on disk.
   */
  slot?: PhonoscopeImageSlot;
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
 * PNG, sniffed from the signature rather than trusted from the upload's
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

/**
 * JPEG, by walking the marker chain to the frame header.
 *
 * There is no fixed offset to read: a JPEG is a sequence of length-prefixed
 * segments and the dimensions live in whichever SOFn marker the encoder chose.
 * So the segments are skipped in order until one turns up. Never transparent —
 * the format has no alpha channel at all.
 *
 * `SOF4` (0xC4) is the Huffman table, `SOF8` (0xC8) is reserved and `SOFC`
 * (0xCC) is arithmetic coding: all three sit inside the 0xC0-0xCF range without
 * being frame headers, which is why they are excluded rather than the range
 * being taken wholesale.
 */
function readJpeg(data: Buffer) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      // Fill bytes are legal padding between segments; anything else means the
      // chain has desynchronised and there is nothing trustworthy left to read.
      offset += 1;
      continue;
    }
    const marker = data[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Start of scan: entropy-coded data from here on, so a frame header that
    // has not turned up by now is not going to.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = data.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: data.readUInt16BE(offset + 5),
        width: data.readUInt16BE(offset + 7),
        hasAlpha: false,
      };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * WebP, in all three of its shapes.
 *
 * A RIFF container whose payload is one of `VP8 ` (lossy), `VP8L` (lossless) or
 * `VP8X` (extended). The dimensions are packed differently in each, and only
 * the last two can carry alpha — `VP8X` says so with a flag bit, `VP8L` with
 * its own header bit, and plain `VP8 ` never can.
 */
function readWebp(data: Buffer) {
  if (data.length < 30) return null;
  if (data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const chunk = data.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    // 24-bit little-endian, and stored as one less than the real size.
    const width = 1 + (data[24] | (data[25] << 8) | (data[26] << 16));
    const height = 1 + (data[27] | (data[28] << 8) | (data[29] << 16));
    return { width, height, hasAlpha: (data[20] & 0x10) !== 0 };
  }
  if (chunk === "VP8L") {
    // 14 bits each, packed across four bytes after the 0x2f signature byte.
    if (data[20] !== 0x2f) return null;
    const bits = data.readUInt32LE(21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
      hasAlpha: ((data[24] >> 4) & 0x08) !== 0,
    };
  }
  if (chunk === "VP8 ") {
    // The keyframe header, after the 3-byte frame tag and the 3-byte sync code.
    if (data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a) return null;
    return {
      width: data.readUInt16LE(26) & 0x3fff,
      height: data.readUInt16LE(28) & 0x3fff,
      hasAlpha: false,
    };
  }
  return null;
}

/**
 * Dimensions, transparency and format, from the bytes alone.
 *
 * Every branch sniffs a signature rather than believing the upload's declared
 * MIME type, because the declared type is attacker-controlled and the extension
 * this writes to disk is derived from the answer.
 */
export function readImageHeader(data: Buffer) {
  const png = readPng(data);
  if (png) return { ...png, format: "png" as const };
  const jpeg = readJpeg(data);
  if (jpeg) return { ...jpeg, format: "jpeg" as const };
  const webp = readWebp(data);
  if (webp) return { ...webp, format: "webp" as const };
  return null;
}

function isImage(value: unknown): value is PhonoscopeImage {
  if (typeof value !== "object" || value === null) return false;
  const image = value as Partial<PhonoscopeImage>;
  return typeof image.id === "string" && typeof image.name === "string"
    && typeof image.width === "number" && typeof image.height === "number"
    && typeof image.size === "number" && typeof image.updatedAt === "string";
}

/**
 * Which slot an untagged entry belongs to.
 *
 * Everything written while there was one shared library is untagged. An entry a
 * colour theme names as its background is a background; everything else was
 * uploaded as, or is being used as, a centrepiece. Derived on read rather than
 * rewritten on disk, so nothing is lost if the configuration changes under it.
 */
function resolvedSlot(image: PhonoscopeImage, backgroundIds: Set<string>): PhonoscopeImageSlot {
  if (image.slot) return image.slot;
  return backgroundIds.has(image.id) ? "background" : "centre";
}

/** Newest first, which is the order the picker shows and eviction walks back. */
export async function readPhonoscopeImages(options: {
  /** Narrow to one library. Omitted, every entry is returned as stored. */
  slot?: PhonoscopeImageSlot;
  /** Ids the configuration uses as a background, for untagged legacy entries. */
  backgroundIds?: Set<string>;
} = {}): Promise<PhonoscopeImage[]> {
  let images: PhonoscopeImage[];
  try {
    const parsed = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
    if (!Array.isArray(parsed)) return [];
    images = parsed
      .filter(isImage)
      .map((image) => ({ ...image, hasAlpha: image.hasAlpha !== false }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [];
  }
  if (!options.slot) return images;
  const backgroundIds = options.backgroundIds ?? new Set<string>();
  return images
    .filter((image) => resolvedSlot(image, backgroundIds) === options.slot)
    .map((image) => ({ ...image, slot: options.slot }));
}

export async function listPhonoscopeImages(
  options: { slot?: PhonoscopeImageSlot; backgroundIds?: Set<string> } = {},
): Promise<PhonoscopeImageSummary[]> {
  const images = await readPhonoscopeImages(options);
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

/**
 * The extension is the format, and it defaults to `png` because that is what
 * every entry written before the library accepted anything else is on disk.
 */
function filePath(id: string, format: PhonoscopeImageFormat = "png") {
  return path.join(IMAGES_DIR, `${id}.${format}`);
}

/** Ids are generated here, so a filename can never come from an upload name. */
function newImageId() {
  return `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The bytes and the content type to serve them as.
 *
 * The format comes from the manifest rather than from probing the directory:
 * the manifest is what the rest of the library trusts, and an entry it does not
 * know about has no business being served whatever is lying next to it on disk.
 */
export async function readPhonoscopeImageFile(id: string) {
  // Belt and braces against a traversal in the route parameter: the id must be
  // exactly what `newImageId` produces.
  if (!/^[A-Za-z0-9_]+$/.test(id)) return null;
  const format = (await readPhonoscopeImages()).find((image) => image.id === id)?.format ?? "png";
  try {
    return {
      data: await readFile(filePath(id, format)),
      contentType: PHONOSCOPE_IMAGE_CONTENT_TYPES[format],
    };
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
  /** Which library it joins. An upload always belongs to the picker it came from. */
  slot: PhonoscopeImageSlot,
  /** Ids the configuration uses as a background, for untagged legacy entries. */
  backgroundIds: Set<string> = new Set(),
): Promise<PhonoscopeImageSummary> {
  const header = readImageHeader(data);
  if (!header) throw new Error("The image must be a PNG, JPEG or WebP");
  if (header.width > MAX_DIMENSION || header.height > MAX_DIMENSION) {
    throw new Error(`The image must be no larger than ${MAX_DIMENSION}px on either side`);
  }

  const image: PhonoscopeImage = {
    id: newImageId(),
    name: (file.name || "Image").slice(0, 120),
    width: header.width,
    height: header.height,
    size: data.byteLength,
    hasAlpha: header.hasAlpha,
    format: header.format,
    slot,
    updatedAt: new Date().toISOString(),
  };

  await mkdir(IMAGES_DIR, { recursive: true });
  await writeFile(filePath(image.id, image.format), data);

  const existing = await readPhonoscopeImages();
  const next = [image, ...existing];
  // Evict from the oldest end of THIS slot, skipping anything the configuration
  // still points at: a colour theme's image disappearing because somebody
  // uploaded twenty others would be a data loss, not a cap. The cap is per
  // library, so filling one never thins the other.
  const evicted: PhonoscopeImage[] = [];
  const mine = () => next.filter((entry) => resolvedSlot(entry, backgroundIds) === slot);
  while (mine().length > PHONOSCOPE_IMAGE_LIMIT) {
    const index = next.map((entry, position) => ({ entry, position }))
      .reverse()
      .find(({ entry }) => !inUse.has(entry.id)
        && resolvedSlot(entry, backgroundIds) === slot)?.position;
    if (index === undefined) break;
    evicted.push(...next.splice(index, 1));
  }

  await writeManifest(next);
  await Promise.allSettled(evicted.map((entry) => unlink(filePath(entry.id, entry.format))));
  return { ...image, url: phonoscopeImageUrl(image) };
}

export async function deletePhonoscopeImage(id: string) {
  const existing = await readPhonoscopeImages();
  const image = existing.find((entry) => entry.id === id);
  if (!image) return false;
  await writeManifest(existing.filter((entry) => entry.id !== id));
  try {
    await unlink(filePath(id, image.format));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return true;
}

/** Orphans left behind by a manual edit of the data directory. */
export async function pruneOrphanedPhonoscopeImages() {
  const images = await readPhonoscopeImages();
  const known = new Set(images.map((image) => `${image.id}.${image.format ?? "png"}`));
  const extensions = Object.keys(PHONOSCOPE_IMAGE_CONTENT_TYPES).map((format) => `.${format}`);
  try {
    const entries = await readdir(IMAGES_DIR);
    await Promise.allSettled(entries
      .filter((entry) => extensions.some((suffix) => entry.endsWith(suffix)) && !known.has(entry))
      .map((entry) => unlink(path.join(IMAGES_DIR, entry))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
