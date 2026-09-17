// Pure helpers for library entries: slot parsing and resolution, serving URL,
// the upload size cap, manifest entry validation and id generation.
import { API_PATH, DEFAULT_MAX_IMAGE_BYTES } from "./constants";
import type { PhonoscopeImage, PhonoscopeImageSlot } from "./types";

export function phonoscopeImageSlot(value: unknown): PhonoscopeImageSlot {
  return value === "background" ? "background" : "centre";
}

export function phonoscopeImageUrl(image: PhonoscopeImage) {
  return `${API_PATH}/${encodeURIComponent(image.id)}?v=${encodeURIComponent(image.updatedAt)}`;
}

export function maxPhonoscopeImageBytes() {
  const parsed = Number(process.env.NOVA_DASHBOARD_PHONOSCOPE_IMAGE_MAX_BYTES);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_IMAGE_BYTES;
  return Math.round(parsed);
}

export function isImage(value: unknown): value is PhonoscopeImage {
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
export function resolvedSlot(image: PhonoscopeImage, backgroundIds: Set<string>): PhonoscopeImageSlot {
  if (image.slot) return image.slot;
  return backgroundIds.has(image.id) ? "background" : "centre";
}

/** Ids are generated here, so a filename can never come from an upload name. */
export function newImageId() {
  return `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
