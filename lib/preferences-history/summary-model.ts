// Pure helpers that turn a patch into a revision's bucket, paths and summary.
import type { JsonPatch } from "../json-patch";
import { SECTION_LABELS, historyDir } from "./constants";

/** `2026-08-06T21:34` — the bucket every write in that minute shares. */
export function minuteBucket(at: Date | string) {
  const date = typeof at === "string" ? new Date(at) : at;
  return date.toISOString().slice(0, 16);
}

/**
 * Timestamp churn is not history.
 *
 * Saving any section stamps its `updatedAt`, so a write that changed nothing
 * else still produces a diff. Recording those would fill the timeline with
 * revert points that restore nothing.
 */
export function isTimestampOnly(patch: JsonPatch) {
  return patch.length > 0 && patch.every((op) => /\/updatedAt$/.test(op.path));
}

/** Pointers trimmed to the branch a person recognises, e.g. `/phonoscope/colorThemes`. */
export function meaningfulPaths(patch: JsonPatch): string[] {
  const seen = new Set<string>();
  for (const op of patch) {
    if (/\/updatedAt$/.test(op.path)) continue;
    const tokens = op.path.split("/").filter(Boolean);
    // Two levels names the feature and the collection inside it; deeper is an
    // index or a field, which the diff view shows anyway.
    seen.add(`/${tokens.slice(0, 2).join("/")}`);
  }
  return [...seen].sort();
}

export function describe(patch: JsonPatch, paths: string[]) {
  const sections = [...new Set(paths.map((pointer) => pointer.split("/")[1] ?? ""))]
    .filter(Boolean)
    .map((key) => SECTION_LABELS[key] ?? key);
  // Timestamp ops ride along with every save. Counting them made a one-field
  // edit read as "2 changed", which is the kind of small lie that stops people
  // trusting a history.
  const real = patch.filter((op) => !/\/updatedAt$/.test(op.path));
  const removals = real.filter((op) => op.op === "remove").length;
  const additions = real.filter((op) => op.op === "add").length;
  const edits = real.filter((op) => op.op === "replace").length;
  const parts: string[] = [];
  if (additions) parts.push(`${additions} added`);
  if (removals) parts.push(`${removals} removed`);
  if (edits) parts.push(`${edits} changed`);
  const where = sections.length ? sections.join(", ") : "Preferences";
  return `${where} — ${parts.join(", ") || "no change"}`;
}

export const __historyInternals = { isTimestampOnly, meaningfulPaths, describe, historyDir };
