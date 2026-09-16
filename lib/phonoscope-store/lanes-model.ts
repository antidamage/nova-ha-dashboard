import { PHONOSCOPE_MODULE_ID } from "../phonoscope";
import { isPhonoscopeThemePulseEffect, PHONOSCOPE_DIVIDE_CHOICES } from "../phonoscope-drivers";
import type {
  PhonoscopeCombineMode,
  PhonoscopeDriver,
  PhonoscopeDriverLane,
  PhonoscopeEffectBinding,
  PhonoscopeSettingsGroup,
} from "../types";
import { finiteClamped, isRecord } from "./color-model";
import {
  PHONOSCOPE_DRIVER_TYPES,
  PHONOSCOPE_EFFECT_ID,
  PHONOSCOPE_MAX_MODIFIERS,
  PHONOSCOPE_PULSE_TYPES,
} from "./constants";

/**
 * Every driver field is always present on the wire. `config_client.cpp` and
 * `PhonoscopeModels.swift` hand-parse the same JSON, and a sparse driver would
 * cost each of them a branch per field.
 */
function normalizeDriver(value: unknown): PhonoscopeDriver {
  const raw = isRecord(value) ? value : {};
  const type = (PHONOSCOPE_DRIVER_TYPES as readonly string[]).includes(String(raw.type))
    ? String(raw.type) as PhonoscopeDriver["type"]
    : "beat";
  const requested = Math.round(finiteClamped(raw.divide, 1, 1, 8));
  const divide = PHONOSCOPE_DIVIDE_CHOICES.includes(requested) ? requested : 1;
  // Counting and subdividing are the two directions of one control: a
  // subdivided driver is always "every one", and its offset is nothing.
  const every = divide > 1 ? 1 : Math.round(finiteClamped(raw.every, 1, 1, 16));
  return {
    type,
    every,
    divide,
    // An offset only means anything inside the cycle it offsets within.
    offset: Math.round(finiteClamped(raw.offset, 0, 0, Math.max(0, every - 1))),
    intervalSeconds: finiteClamped(raw.intervalSeconds, 4, 0.25, 600),
    cadence: (PHONOSCOPE_PULSE_TYPES as readonly string[]).includes(String(raw.cadence))
      ? String(raw.cadence) as PhonoscopeDriver["cadence"]
      : "beat",
  };
}

/**
 * Bindings stay sparse: an absent field inherits the effect's declaration, so
 * only what the author actually set is written back. Ranges are deliberately
 * not clamped here — the declaration that bounds them belongs to the module,
 * which the evaluator resolves against at draw time.
 */
function normalizeBinding(value: unknown, index: number): PhonoscopeEffectBinding | null {
  if (!isRecord(value)) return null;
  const effect = typeof value.effect === "string" ? value.effect.trim() : "";
  if (!PHONOSCOPE_EFFECT_ID.test(effect)) return null;
  const binding: PhonoscopeEffectBinding = {
    id: typeof value.id === "string" && value.id.trim()
      ? value.id.trim().slice(0, 64)
      : `bind_${index + 1}`,
    effect,
  };
  // The rotation pulses are instructions — any non-zero contribution advances
  // the rotation or flips the alt state — so their range is fixed at the
  // declared 0-1 and the editor does not offer it. Dropping a stored range
  // keeps what runs identical to what is shown.
  if (!isPhonoscopeThemePulseEffect(effect)) {
    if (Number.isFinite(Number(value.min))) binding.min = Number(value.min);
    if (Number.isFinite(Number(value.max))) binding.max = Number(value.max);
  }
  if (Number.isFinite(Number(value.attackSeconds))) {
    binding.attackSeconds = finiteClamped(value.attackSeconds, 0.05, 0, 60);
  }
  if (Number.isFinite(Number(value.holdSeconds))) {
    binding.holdSeconds = finiteClamped(value.holdSeconds, 0, 0, 60);
  }
  if (Number.isFinite(Number(value.releaseSeconds))) {
    binding.releaseSeconds = finiteClamped(value.releaseSeconds, 0.6, 0, 600);
  }
  // Sparse like everything else: off is simply absent, so only a binding that
  // actually randomises its target carries the flag.
  if (value.randomValue === true) binding.randomValue = true;
  if (isRecord(value.params)) {
    const params: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value.params)) {
      if (/^[a-z][a-zA-Z0-9_]{0,31}$/.test(key) && Number.isFinite(Number(entry))) {
        params[key] = Number(entry);
      }
    }
    if (Object.keys(params).length) binding.params = params;
  }
  return binding;
}

function normalizeLane(value: unknown, index: number): PhonoscopeDriverLane | null {
  if (!isRecord(value)) return null;
  return {
    id: typeof value.id === "string" && value.id.trim()
      ? value.id.trim().slice(0, 64)
      : `lane_${index + 1}`,
    driver: normalizeDriver(value.driver),
    modifiers: Array.isArray(value.modifiers)
      ? value.modifiers.slice(0, PHONOSCOPE_MAX_MODIFIERS).map(normalizeDriver)
      : [],
    bindings: Array.isArray(value.bindings)
      ? value.bindings.flatMap((entry, position) => {
          const binding = normalizeBinding(entry, position);
          return binding ? [binding] : [];
        })
      : [],
  };
}

/**
 * Drop bindings the installed module no longer declares, and with them any lane
 * left with nothing resolvable.
 *
 * A lane that has *never* had a binding is not stale — it is one the editor has
 * just added and the user has not wired an effect into yet. Pruning it too made
 * "Add driver lane" silently undo itself on the first save, which read as the
 * button doing nothing at all.
 */
export function prunePhonoscopeLanes(
  lanes: PhonoscopeDriverLane[],
  declarations: ReadonlyMap<string, unknown> | ReadonlySet<string>,
): PhonoscopeDriverLane[] {
  const declares = (effect: string) => declarations.has(effect);
  return lanes.flatMap((lane) => {
    const bindings = lane.bindings.filter((binding) => declares(binding.effect));
    if (lane.bindings.length > 0 && bindings.length === 0) return [];
    return [{ ...lane, bindings }];
  });
}

export function normalizePhonoscopeSettingsGroups(value: unknown): PhonoscopeSettingsGroup[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const groups = value.flatMap((raw, index): PhonoscopeSettingsGroup[] => {
    if (!isRecord(raw)) return [];
    const id = typeof raw.id === "string" && PHONOSCOPE_MODULE_ID.test(raw.id)
      ? raw.id
      : `settings_${index + 1}`;
    if (ids.has(id)) return [];
    ids.add(id);
    const combine: Record<string, PhonoscopeCombineMode> = {};
    if (isRecord(raw.combine)) {
      for (const [effect, mode] of Object.entries(raw.combine)) {
        // Anything unrecognised reads as `add`, which is what every effect did
        // before combine modes existed — a config written by a newer dashboard
        // degrades rather than being rejected.
        if (PHONOSCOPE_EFFECT_ID.test(effect)) {
          combine[effect] = mode === "strongest" || mode === "common" || mode === "override"
            ? mode
            : "add";
        }
      }
    }
    const staticSettings: Record<string, number> = {};
    if (isRecord(raw.staticSettings)) {
      for (const [setting, entry] of Object.entries(raw.staticSettings)) {
        if (PHONOSCOPE_EFFECT_ID.test(setting) && Number.isFinite(Number(entry))) {
          staticSettings[setting] = Number(entry);
        }
      }
    }
    return [{
      id,
      name: typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 60)
        : `Settings ${index + 1}`,
      moduleId: typeof raw.moduleId === "string" && PHONOSCOPE_MODULE_ID.test(raw.moduleId)
        ? raw.moduleId
        : "particle-ripples",
      lanes: Array.isArray(raw.lanes)
        ? raw.lanes.flatMap((entry, position) => {
            const lane = normalizeLane(entry, position);
            return lane ? [lane] : [];
          })
        : [],
      combine,
      staticSettings,
      isDefault: raw.isDefault === true,
    }];
  });
  if (!groups.length) return groups;
  // Exactly one group carries the default flag. Everything falls back to it, so
  // an absent or duplicated flag is repaired rather than rejected.
  const chosen = Math.max(0, groups.findIndex((group) => group.isDefault));
  groups.forEach((group, index) => { group.isDefault = index === chosen; });
  return groups;
}

