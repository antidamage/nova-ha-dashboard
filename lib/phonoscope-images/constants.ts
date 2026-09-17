// Serving path, size and dimension limits, the per-slot history cap, the slot
// list and the format-to-content-type table.
import type { PhonoscopeImageFormat, PhonoscopeImageSlot } from "./types";

export const API_PATH = "/api/phonoscope/images";

/**
 * Raised from 8 MB when the library stopped being logos only. A 4K photograph
 * is a normal background and a normal background is tens of megabytes as a PNG;
 * the old cap rejected most real ones.
 */
export const DEFAULT_MAX_IMAGE_BYTES = 32 * 1024 * 1024;
/**
 * Raised from 4096 for the same reason: a 5K or 6K source downscaled to the
 * output is a reasonable thing to hand a 4K renderer, and refusing it forces a
 * resize outside Nova for no gain.
 */
export const MAX_DIMENSION = 8192;

/**
 * How many uploads the history keeps, PER SLOT. Old enough to have forgotten
 * why you uploaded something, small enough that the picker stays a picker.
 */
export const PHONOSCOPE_IMAGE_LIMIT = 20;

export const PHONOSCOPE_IMAGE_SLOTS: PhonoscopeImageSlot[] = ["centre", "background"];

export const PHONOSCOPE_IMAGE_CONTENT_TYPES: Record<PhonoscopeImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
