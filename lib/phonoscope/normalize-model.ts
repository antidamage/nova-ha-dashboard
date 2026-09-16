import {
  PHONOSCOPE_CORE_PALETTE_SLOTS,
  PHONOSCOPE_MODULE_ID,
  PHONOSCOPE_PALETTE_SLOT_ID,
} from "./constants";
import { compilePhonoscopeExpression } from "./expression";
import type {
  PhonoscopeBoundaryMode,
  PhonoscopeCompiledModule,
  PhonoscopeControlOption,
  PhonoscopeControlType,
  PhonoscopePaletteSlot,
  PhonoscopeSetting,
} from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function compileValues(value: unknown, path: string, errors: string[]): unknown {
  if (typeof value === "string" && value.trimStart().startsWith("=")) {
    try {
      return compilePhonoscopeExpression(value);
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : "invalid expression"}`);
      return value;
    }
  }
  if (Array.isArray(value)) return value.map((entry, index) => compileValues(entry, `${path}[${index}]`, errors));
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (["shader", "script", "javascript", "metalSource", "executable", "binary"].includes(key)) {
      errors.push(`${path}.${key}: executable content is not allowed`);
      continue;
    }
    output[key] = compileValues(entry, `${path}.${key}`, errors);
  }
  return output;
}

export function normalizeBoundary(value: unknown, errors: string[]) {
  const raw = typeof value === "string" ? { mode: value } : isRecord(value) ? value : { mode: "bounce" };
  const modes: PhonoscopeBoundaryMode[] = ["despawn", "wrap", "bounce", "slide", "clamp", "respawn", "trigger"];
  const mode = modes.includes(raw.mode as PhonoscopeBoundaryMode) ? raw.mode as PhonoscopeBoundaryMode : "bounce";
  if (raw.mode !== undefined && raw.mode !== mode) errors.push(`boundary.mode: unsupported mode '${String(raw.mode)}'`);
  const result: PhonoscopeCompiledModule["boundary"] = {
    mode,
    restitution: Math.max(0, Math.min(1.5, finiteNumber(raw.restitution, 0.82))),
  };
  if (mode === "trigger") {
    const then = raw.then;
    if (typeof then === "string" && modes.includes(then as PhonoscopeBoundaryMode) && then !== "trigger") result.then = then as Exclude<PhonoscopeBoundaryMode, "trigger">;
    else result.then = "bounce";
    if (typeof raw.effect === "string" && raw.effect.trim()) result.effect = raw.effect.trim();
  }
  return result;
}

export function normalizeSettings(value: unknown, errors: string[]): PhonoscopeSetting[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push("settings: expected an array");
    return [];
  }
  const seen = new Set<string>();
  return value.flatMap((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !PHONOSCOPE_MODULE_ID.test(entry.id)) {
      errors.push(`settings[${index}]: invalid id`);
      return [];
    }
    if (seen.has(entry.id)) {
      errors.push(`settings[${index}]: duplicate id '${entry.id}'`);
      return [];
    }
    seen.add(entry.id);
    const supportedControls: PhonoscopeControlType[] = ["slider", "number", "toggle", "select"];
    const control = entry.control === undefined
      ? "slider"
      : supportedControls.includes(entry.control as PhonoscopeControlType)
        ? entry.control as PhonoscopeControlType
        : "slider";
    if (entry.control !== undefined && entry.control !== control) {
      errors.push(`settings[${index}].control: unsupported control '${String(entry.control)}'`);
    }

    const options: PhonoscopeControlOption[] = [];
    if (control === "select") {
      if (!Array.isArray(entry.options) || entry.options.length < 2) {
        errors.push(`settings[${index}].options: select controls require at least two options`);
      } else {
        entry.options.forEach((option, optionIndex) => {
          if (!isRecord(option) || typeof option.label !== "string" || !option.label.trim()
            || typeof option.value !== "number" || !Number.isFinite(option.value)) {
            errors.push(`settings[${index}].options[${optionIndex}]: expected a label and finite numeric value`);
            return;
          }
          if (options.some((existing) => existing.value === option.value)) {
            errors.push(`settings[${index}].options[${optionIndex}]: duplicate value`);
            return;
          }
          options.push({ label: option.label.trim(), value: option.value });
        });
      }
    }

    const optionValues = options.map((option) => option.value);
    const min = control === "toggle" ? 0
      : control === "select" && optionValues.length ? Math.min(...optionValues)
        : finiteNumber(entry.min, 0);
    const max = control === "toggle" ? 1
      : control === "select" && optionValues.length ? Math.max(...optionValues)
        : finiteNumber(entry.max, 1);
    if (max < min) errors.push(`settings[${index}]: max must be >= min`);
    let defaultValue = Math.max(min, Math.min(max, finiteNumber(entry.default, min)));
    if (control === "toggle") defaultValue = defaultValue >= 0.5 ? 1 : 0;
    if (control === "select" && optionValues.length && !optionValues.includes(defaultValue)) {
      errors.push(`settings[${index}].default: expected one of the declared option values`);
      defaultValue = optionValues[0];
    }

    const curveValue = isRecord(entry.curve) ? entry.curve : {};
    const curveType = curveValue.type === undefined || curveValue.type === "linear"
      ? "linear"
      : curveValue.type === "power"
        ? "power"
        : "linear";
    if (curveValue.type !== undefined && curveValue.type !== curveType) {
      errors.push(`settings[${index}].curve.type: unsupported curve '${String(curveValue.type)}'`);
    }
    const exponent = finiteNumber(curveValue.exponent, curveType === "power" ? 2 : 1);
    if (exponent < 0.1 || exponent > 8) {
      errors.push(`settings[${index}].curve.exponent: expected a value from 0.1 to 8`);
    }

    const affects = Array.isArray(entry.affects)
      ? entry.affects.flatMap((target, targetIndex) => {
          if (typeof target !== "string" || !/^[A-Za-z][A-Za-z0-9_.\-[\]]{0,127}$/.test(target)) {
            errors.push(`settings[${index}].affects[${targetIndex}]: invalid target path`);
            return [];
          }
          return [target];
        })
      : [];
    if (entry.affects !== undefined && !Array.isArray(entry.affects)) {
      errors.push(`settings[${index}].affects: expected an array of target paths`);
    }

    return [{
      id: entry.id,
      label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : entry.id,
      description: typeof entry.description === "string" ? entry.description.trim().slice(0, 512) : "",
      control,
      min,
      max,
      step: control === "toggle" || control === "select"
        ? 1
        : Math.max(Number.EPSILON, finiteNumber(entry.step, Math.max((max - min) / 100, 0.01))),
      default: defaultValue,
      affects,
      curve: {
        type: curveType,
        exponent: Math.max(0.1, Math.min(8, exponent)),
      },
      options,
      section: typeof entry.section === "string" ? entry.section.trim().slice(0, 64) : "",
      group: typeof entry.group === "string" ? entry.group.trim().slice(0, 64) : "",
      // Not validated against the panel's known parameter groups on purpose: an
      // unrecognised name already falls back to the effect's first group, and
      // rejecting one would couple module compilation to the dashboard's UI
      // layout.
      parameterGroup: typeof entry.parameterGroup === "string"
        ? entry.parameterGroup.trim().slice(0, 64)
        : "",
      updateMode: entry.updateMode === "structural" ? "structural" : "smooth",
    }];
  });
}

export function normalizePaletteSlots(value: unknown, errors: string[]): PhonoscopePaletteSlot[] {
  if (value === undefined) return PHONOSCOPE_CORE_PALETTE_SLOTS.map((slot) => ({ ...slot }));
  if (!Array.isArray(value)) {
    errors.push("paletteSlots: expected an array");
    return PHONOSCOPE_CORE_PALETTE_SLOTS.map((slot) => ({ ...slot }));
  }
  const slots: PhonoscopePaletteSlot[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !PHONOSCOPE_PALETTE_SLOT_ID.test(entry.id)) {
      errors.push(`paletteSlots[${index}]: invalid id`);
      return;
    }
    if (seen.has(entry.id)) {
      errors.push(`paletteSlots[${index}]: duplicate id`);
      return;
    }
    if (typeof entry.label !== "string" || !entry.label.trim()) {
      errors.push(`paletteSlots[${index}].label: expected a label`);
      return;
    }
    const rawRgb = entry.defaultRgb;
    if (!Array.isArray(rawRgb) || rawRgb.length !== 3 || rawRgb.some((part) => !Number.isFinite(Number(part)))) {
      errors.push(`paletteSlots[${index}].defaultRgb: expected three numeric RGB components`);
      return;
    }
    seen.add(entry.id);
    slots.push({
      id: entry.id,
      label: entry.label.trim().slice(0, 60),
      defaultRgb: rawRgb.map((part) => Math.max(0, Math.min(255, Math.round(Number(part))))) as [number, number, number],
    });
  });
  return slots;
}
