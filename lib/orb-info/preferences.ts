import { DEFAULT_ORB_MODULE_ID, ORB_INFO_MODULES_BY_ID, orbModuleById } from "./catalogue";
import { DEFAULT_ORB_DISPLAY } from "./format";
import type {
  OrbDisplayUnit,
  OrbInfoDisplay,
  OrbInfoFormat,
  OrbInfoPreferences,
  OrbPercentBasis,
  OrbRounding,
} from "./types";

const FORMATS: OrbInfoFormat[] = ["number", "duration", "percent", "clock", "temperature", "text"];
const UNITS: OrbDisplayUnit[] = [
  "native", "auto", "seconds", "minutes", "hours", "days", "weeks",
  "celsius", "fahrenheit", "watts", "kilowatts",
];
const ROUNDINGS: OrbRounding[] = ["floor", "round", "ceil"];

/** Free-form label text is user-authored; keep it short enough to fit the orb. */
const MAX_AFFIX_LENGTH = 8;

function pick<T>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function affix(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.slice(0, MAX_AFFIX_LENGTH);
}

function decimals(value: unknown, fallback: OrbInfoDisplay["decimals"]): OrbInfoDisplay["decimals"] {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.max(0, Math.min(3, Math.round(parsed)));
  return clamped as OrbInfoDisplay["decimals"];
}

function percentBasis(value: unknown, fallback: OrbPercentBasis): OrbPercentBasis {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  if (record.kind === "moduleThreshold") return { kind: "moduleThreshold" };
  if (record.kind === "fixed") {
    const parsed = Number(record.value);
    // A zero or negative basis would divide the readout into nonsense.
    if (Number.isFinite(parsed) && parsed > 0) return { kind: "fixed", value: parsed };
  }
  return fallback;
}

export function normalizeOrbDisplay(value: unknown, base: OrbInfoDisplay = DEFAULT_ORB_DISPLAY): OrbInfoDisplay {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    format: pick(raw.format, FORMATS, base.format),
    unit: pick(raw.unit, UNITS, base.unit),
    decimals: decimals(raw.decimals, base.decimals),
    rounding: pick(raw.rounding, ROUNDINGS, base.rounding),
    percentOf: percentBasis(raw.percentOf, base.percentOf),
    percentClamp: boolOr(raw.percentClamp, base.percentClamp),
    percentInvert: boolOr(raw.percentInvert, base.percentInvert),
    showUnit: boolOr(raw.showUnit, base.showUnit),
    signed: boolOr(raw.signed, base.signed),
    clock12Hour: boolOr(raw.clock12Hour, base.clock12Hour),
    clockSeconds: boolOr(raw.clockSeconds, base.clockSeconds),
    prefix: affix(raw.prefix, base.prefix),
    suffix: affix(raw.suffix, base.suffix),
    emptyText: affix(raw.emptyText, base.emptyText),
  };
}

/** The effective display for a module: its defaults, overlaid with the saved edits. */
export function resolveOrbDisplay(preferences: OrbInfoPreferences | undefined, moduleId: string): OrbInfoDisplay {
  const module = orbModuleById(moduleId);
  const saved = preferences?.modules?.[module.id]?.display;
  const resolved = normalizeOrbDisplay(saved, module.defaultDisplay);
  // A saved format the module does not support (renamed module, hand-edited
  // preferences) must not strand the readout on an unrenderable format.
  if (!module.supportedFormats.includes(resolved.format)) {
    return { ...resolved, format: module.defaultDisplay.format };
  }
  return resolved;
}

export function resolveOrbModuleId(preferences: OrbInfoPreferences | undefined): string {
  const id = preferences?.moduleId;
  return typeof id === "string" && ORB_INFO_MODULES_BY_ID[id] ? id : DEFAULT_ORB_MODULE_ID;
}

export function normalizedOrbInfoPreferences(value: OrbInfoPreferences | undefined): OrbInfoPreferences {
  const moduleId = resolveOrbModuleId(value);
  const modules: OrbInfoPreferences["modules"] = {};
  for (const [id, entry] of Object.entries(value?.modules ?? {})) {
    const module = ORB_INFO_MODULES_BY_ID[id];
    // Drop entries for modules that no longer exist rather than carrying dead
    // config forward forever.
    if (!module || !entry || typeof entry !== "object") continue;
    modules[id] = {
      display: normalizeOrbDisplay(entry.display, module.defaultDisplay),
      ...(entry.params && typeof entry.params === "object" ? { params: entry.params } : {}),
    };
  }
  return { ...value, moduleId, modules };
}
