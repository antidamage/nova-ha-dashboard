// Per-module config read/write and the schema-driven coercion applied to any
// incoming config, whether typed by hand or imported from an export.

import path from "path";
import type { ModuleManifest } from "../manifest";
import { enqueue, isRecord, moduleDir, readJson, writeJsonAtomic } from "./store";

export async function readModuleConfig(id: string): Promise<Record<string, unknown>> {
  const value = await readJson(path.join(moduleDir(id), "config.json"));
  return isRecord(value) ? value : {};
}

export async function writeModuleConfig(id: string, config: Record<string, unknown>) {
  return enqueue(() => writeJsonAtomic(path.join(moduleDir(id), "config.json"), config));
}

/**
 * Coerce an incoming config against the manifest's schema. Unknown keys are
 * dropped rather than stored, and a value of the wrong type falls back to the
 * schema default — a bad import should not be able to wedge a module.
 */
export function coerceModuleConfig(
  manifest: ModuleManifest,
  input: unknown,
): Record<string, unknown> {
  const source = isRecord(input) ? input : {};
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(manifest.configSchema.properties)) {
    if (field.type === "array") {
      // Rows of leaves. A row that coerces to nothing at all is dropped rather
      // than kept as {} -- an empty row in a mapping like the Discord module's
      // `accounts` is not a mapping, and keeping it would let a half-filled row
      // look like a configured one.
      const rows = Array.isArray(source[key]) ? (source[key] as unknown[]) : [];
      const limit = field.maxItems ?? 50;
      const coerced: Record<string, unknown>[] = [];
      for (const row of rows.slice(0, limit)) {
        const nestedRow = isRecord(row) ? (row as Record<string, unknown>) : {};
        const out_row: Record<string, unknown> = {};
        for (const [childKey, child] of Object.entries(field.items.properties)) {
          const value = coerceLeaf(child, nestedRow[childKey]);
          if (value !== undefined) {
            out_row[childKey] = value;
          }
        }
        if (Object.keys(out_row).length > 0) {
          coerced.push(out_row);
        }
      }
      out[key] = coerced;
      continue;
    }
    if (field.type === "object") {
      const nested = isRecord(source[key]) ? (source[key] as Record<string, unknown>) : {};
      const group: Record<string, unknown> = {};
      for (const [childKey, child] of Object.entries(field.properties)) {
        const value = coerceLeaf(child, nested[childKey]);
        if (value !== undefined) {
          group[childKey] = value;
        }
      }
      out[key] = group;
      continue;
    }
    const value = coerceLeaf(field, source[key]);
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function coerceLeaf(
  field: { type: "boolean" | "string" | "number"; default?: unknown; enum?: string[]; minimum?: number; maximum?: number },
  value: unknown,
): unknown {
  if (field.type === "boolean") {
    return typeof value === "boolean" ? value : (field.default as boolean | undefined);
  }
  if (field.type === "number") {
    const numeric = typeof value === "number" && Number.isFinite(value) ? value : undefined;
    if (numeric === undefined) {
      return field.default as number | undefined;
    }
    const min = field.minimum ?? Number.NEGATIVE_INFINITY;
    const max = field.maximum ?? Number.POSITIVE_INFINITY;
    return Math.min(Math.max(numeric, min), max);
  }
  const text = typeof value === "string" ? value : undefined;
  if (text === undefined) {
    return field.default as string | undefined;
  }
  if (field.enum && !field.enum.includes(text)) {
    return field.default as string | undefined;
  }
  return text;
}

/**
 * Export drops every `format: "secret"` value entirely rather than blanking it,
 * so an exported file cannot be mistaken for one that carries a token.
 */
export function exportableModuleConfig(manifest: ModuleManifest, config: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(manifest.configSchema.properties)) {
    if (field.type === "array") {
      const rows = Array.isArray(config[key]) ? (config[key] as unknown[]) : [];
      out[key] = rows.map((row) => {
        const nestedRow = isRecord(row) ? (row as Record<string, unknown>) : {};
        const out_row: Record<string, unknown> = {};
        for (const [childKey, child] of Object.entries(field.items.properties)) {
          if (child.format === "secret") {
            continue;
          }
          if (childKey in nestedRow) {
            out_row[childKey] = nestedRow[childKey];
          }
        }
        return out_row;
      });
      continue;
    }
    if (field.type !== "object") {
      if (field.format === "secret") {
        continue;
      }
      if (key in config) {
        out[key] = config[key];
      }
      continue;
    }
    const nested = isRecord(config[key]) ? (config[key] as Record<string, unknown>) : {};
    const group: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(field.properties)) {
      if (child.format === "secret") {
        continue;
      }
      if (childKey in nested) {
        group[childKey] = nested[childKey];
      }
    }
    out[key] = group;
  }
  return out;
}
