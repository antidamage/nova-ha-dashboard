// Image library entry shapes. Formats and slots are persisted per entry in the manifest.

/** Which picker an image belongs to. */
export type PhonoscopeImageSlot = "centre" | "background";

/**
 * APPEND-ONLY, and stored per entry: the extension on disk is the format, so
 * renaming one orphans every file already written under the old name.
 */
export type PhonoscopeImageFormat = "png" | "jpeg" | "webp";

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
