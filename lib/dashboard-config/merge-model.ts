// How configuration layers combine. Pure: no disk, no env.
//
// Objects merge key by key and arrays replace wholesale, which is what makes a
// list in the household overlay the whole list rather than an append. See
// specs/configuration-model.md.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mergeDeep<T>(base: T, override: unknown): T {
  if (!isRecord(base) || !isRecord(override)) {
    return override === undefined ? base : override as T;
  }

  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    next[key] = key in next ? mergeDeep(next[key], value) : value;
  }
  return next as T;
}
