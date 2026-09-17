/**
 * Phonoscope image libraries — facade. The body lives in lib/phonoscope-images/;
 * this file keeps the import path stable for its callers
 * (specs/agent-token-footprint.md §3.3). Server-only: store.ts uses fs.
 *
 *   phonoscope-images/types.ts          slot, format, entry and summary shapes
 *   phonoscope-images/constants.ts      serving path, size/dimension limits, history cap, content types
 *   phonoscope-images/header-model.ts   PNG, JPEG and WebP header sniffing
 *   phonoscope-images/library-model.ts  slot parsing and resolution, URLs, entry validation, ids
 *   phonoscope-images/store.ts          SOLE owner of disk state: image files and the manifest
 */

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
export type {
  PhonoscopeImage,
  PhonoscopeImageFormat,
  PhonoscopeImageSlot,
  PhonoscopeImageSummary,
} from "./phonoscope-images/types";
export {
  PHONOSCOPE_IMAGE_CONTENT_TYPES,
  PHONOSCOPE_IMAGE_LIMIT,
  PHONOSCOPE_IMAGE_SLOTS,
} from "./phonoscope-images/constants";
export { readImageHeader, readPng } from "./phonoscope-images/header-model";
export { maxPhonoscopeImageBytes, phonoscopeImageSlot, phonoscopeImageUrl } from "./phonoscope-images/library-model";
export {
  deletePhonoscopeImage,
  listPhonoscopeImages,
  phonoscopeImageUrls,
  pruneOrphanedPhonoscopeImages,
  readPhonoscopeImageFile,
  readPhonoscopeImages,
  savePhonoscopeImage,
} from "./phonoscope-images/store";
