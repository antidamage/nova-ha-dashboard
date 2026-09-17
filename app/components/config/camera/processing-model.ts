// Fill missing processing values from the defaults table.
import { FALLBACK } from "./constants";
import type { Processing } from "./types";

export function normalizeProcessing(value: Partial<Processing> | null | undefined): Processing {
  return {
    brightness: typeof value?.brightness === "number" ? value.brightness : FALLBACK.brightness,
    contrast: typeof value?.contrast === "number" ? value.contrast : FALLBACK.contrast,
    sharpness: typeof value?.sharpness === "number" ? value.sharpness : FALLBACK.sharpness,
  };
}
