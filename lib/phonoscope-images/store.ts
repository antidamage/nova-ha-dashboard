// The phonoscope-images package's only owner of disk state: the image files and
// manifest under data/phonoscope/images — reading, listing, saving with per-slot
// eviction, deleting and pruning orphans.
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "fs/promises";
import path from "path";
import { MAX_DIMENSION, PHONOSCOPE_IMAGE_CONTENT_TYPES, PHONOSCOPE_IMAGE_LIMIT } from "./constants";
import { readImageHeader } from "./header-model";
import { isImage, newImageId, phonoscopeImageUrl, resolvedSlot } from "./library-model";
import type { PhonoscopeImage, PhonoscopeImageFormat, PhonoscopeImageSlot, PhonoscopeImageSummary } from "./types";

const IMAGES_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "phonoscope", "images");
const MANIFEST_PATH = path.join(IMAGES_DIR, "manifest.json");

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
