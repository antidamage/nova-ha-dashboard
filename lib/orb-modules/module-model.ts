// Status Orb module format: whole-document normalization.

import { decimalStepGranularity } from "../slider-step";
import { ORB_MODULE_FORMAT_VERSION } from "./constants";
import type { OrbModuleSettingDecl, OrbModuleSettingMigration } from "./types";
import type { OrbLayer, OrbModule } from "./layer-types";
import { clamp, clampedNum, isValidOrbModuleId, num, recordValue } from "./value-model";
import { normalizeOrbLayer } from "./layer-model";

/** Normalize one setting declaration; null when it has no usable id. */
function normalizeOrbModuleSetting(value: unknown): OrbModuleSettingDecl | null {
  const v = recordValue(value);
  if (!v || !isValidOrbModuleId(v.id)) return null;
  const min = num(v.min, 0);
  const max = Math.max(min, num(v.max, Math.max(min, 100)));
  const span = max - min;
  const decl: OrbModuleSettingDecl = {
    id: v.id,
    label: typeof v.label === "string" && v.label.trim().length > 0
      ? v.label.trim().slice(0, 40)
      : v.id,
    min,
    max,
    step: span > 0 ? decimalStepGranularity(clampedNum(v.step, 1, 0.001, span)) : 1,
    default: clamp(num(v.default, min), min, max),
  };
  if (typeof v.description === "string" && v.description.trim().length > 0) {
    decl.description = v.description.trim().slice(0, 140);
  }
  // A choice setting names every stop. Keep the labels only when there is one
  // per step — a list that does not line up with min..max would label a stop
  // with another stop's name, so it is dropped and the setting stays a
  // magnitude rather than being silently mislabelled.
  const options = normalizeOrbSettingOptions(v.options);
  if (options && options.length === Math.round(span / decl.step) + 1 && options.length >= 2) {
    decl.options = options;
  }
  return decl;
}

/** The named stops of a choice setting; undefined when the list is unusable. */
function normalizeOrbSettingOptions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return undefined;
    const label = entry.trim();
    if (label.length === 0 || label.length > 24) return undefined;
    options.push(label);
  }
  return options.length > 0 ? options : undefined;
}

/**
 * Normalize a full module document. Returns null when the document is not
 * usable at all (bad id or no valid layers); callers then fall back to the
 * built-in classic module so the orb always renders something.
 */
export function normalizeOrbModule(value: unknown): OrbModule | null {
  const v = recordValue(value);
  if (!v) return null;
  if (!isValidOrbModuleId(v.id)) return null;

  // Reject documents from a NEWER major format than we understand; older or
  // missing versions are normalized forward.
  const formatVersion = Math.round(num(v.formatVersion, ORB_MODULE_FORMAT_VERSION));
  if (formatVersion > ORB_MODULE_FORMAT_VERSION) return null;

  const layersRaw = Array.isArray(v.layers) ? v.layers : [];
  const layers = layersRaw
    .map(normalizeOrbLayer)
    .filter((layer): layer is OrbLayer => layer !== null);
  if (layers.length === 0) return null;

  // Setting declarations, deduplicated by id (first declaration wins).
  const settingsRaw = Array.isArray(v.settings) ? v.settings : [];
  const settings: OrbModuleSettingDecl[] = [];
  const seenSettingIds = new Set<string>();
  for (const entry of settingsRaw) {
    const setting = normalizeOrbModuleSetting(entry);
    if (setting && !seenSettingIds.has(setting.id)) {
      seenSettingIds.add(setting.id);
      settings.push(setting);
    }
  }

  const module: OrbModule = {
    formatVersion: ORB_MODULE_FORMAT_VERSION,
    id: v.id as string,
    name: typeof v.name === "string" && v.name.trim().length > 0
      ? v.name.trim().slice(0, 80)
      : (v.id as string),
    description: typeof v.description === "string" ? v.description.trim().slice(0, 200) : "",
    alertPulsePeriod: clampedNum(v.alertPulsePeriod, 1.2, 0.05, 60),
    layers,
  };
  if (settings.length > 0) {
    module.settings = settings;
  }
  const migrations = normalizeOrbSettingMigrations(v.settingMigrations, settings);
  if (migrations.length > 0) {
    module.settingMigrations = migrations;
  }
  return module;
}

/**
 * Normalize a module's setting history. A migration that names no declared
 * setting, carries no legacy ids, or offers no bands paints nothing and is
 * dropped — a stale entry left behind by an earlier edit must not make the
 * document unusable.
 */
function normalizeOrbSettingMigrations(
  value: unknown,
  settings: OrbModuleSettingDecl[],
): OrbModuleSettingMigration[] {
  const raw = Array.isArray(value) ? value : [];
  const declared = new Set(settings.map((decl) => decl.id));
  const migrations: OrbModuleSettingMigration[] = [];
  for (const entry of raw) {
    const v = recordValue(entry);
    if (!v || !isValidOrbModuleId(v.to) || !declared.has(v.to)) continue;
    const from = (Array.isArray(v.from) ? v.from : []).filter(isValidOrbModuleId);
    const bands = normalizeOrbMigrationBands(v.bands);
    if (from.length === 0 || bands.length === 0) continue;
    migrations.push({ to: v.to, from, bands });
  }
  return migrations;
}

/** A migration's bands: a numeric floor and the stop name it maps to. */
function normalizeOrbMigrationBands(value: unknown): OrbModuleSettingMigration["bands"] {
  const raw = Array.isArray(value) ? value : [];
  const bands: OrbModuleSettingMigration["bands"] = [];
  for (const entry of raw) {
    const v = recordValue(entry);
    if (!v || !Number.isFinite(Number(v.min))) continue;
    // A band names one of the setting's own stops; an empty name names
    // nothing, and the band is dropped rather than migrating to a stop that
    // cannot be looked up.
    if (typeof v.name !== "string" || v.name.trim().length === 0) continue;
    bands.push({ min: Number(v.min), name: v.name.trim() });
  }
  return bands.sort((a: OrbModuleSettingMigration["bands"][number], b: OrbModuleSettingMigration["bands"][number]) => a.min - b.min);
}
