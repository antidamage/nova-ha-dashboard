// Status Orb module format: whole-document normalization.

import { decimalStepGranularity } from "../slider-step";
import { ORB_MODULE_FORMAT_VERSION } from "./constants";
import type { OrbModuleSettingDecl } from "./types";
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
  return decl;
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
  return module;
}
