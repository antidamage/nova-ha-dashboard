// Status Orb module format: primitive coercion shared by the normalizers,
// settings resolution and colour resolution.

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Coerce to a finite number, else the fallback. */
export function num(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Coerce to a finite number clamped to [min, max], else the fallback. */
export function clampedNum(value: unknown, fallback: number, min: number, max: number) {
  return clamp(num(value, fallback), min, max);
}

export function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Module ids must be url/file-safe so they map cleanly to module filenames. */
const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

export function isValidOrbModuleId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && MODULE_ID_PATTERN.test(value);
}
