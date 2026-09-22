import { controlModuleIn } from "./catalogue";
import { resolveRoom } from "./rooms";
import { presetById } from "./presets";
import type {
  ControlModule,
  ControlPreset,
  ControlSlot,
  ControlSlotSurface,
  ControlsConfig,
  ResolvedSlot,
} from "./types";

/**
 * Slots: the places on a dashboard surface that hold a preset
 * (specs/control-modules.md).
 *
 * A slot is a reference, never a copy — the preset holds the device, the room
 * and the settings, so editing one preset updates every slot showing it and
 * deleting it can be reported rather than leaving six controls blank. Order is
 * array order, which is what makes "the slot row" mean something without a
 * separate ordering field.
 *
 * A slot whose preset is missing or whose module is not installed is DROPPED,
 * not rendered empty: an empty control is a permanent hole on the surface, and
 * the Devices tab already reports the same problem in words.
 */

export function slotsForSurface(controls: ControlsConfig, surface: ControlSlotSurface): ControlSlot[] {
  return controls.slots.filter((slot) => slot.surface === surface && slot.visible);
}

export function resolveSlot(
  slot: ControlSlot,
  presets: readonly ControlPreset[],
  modules: readonly ControlModule[],
): ResolvedSlot | null {
  const preset = presetById(presets, slot.presetId);
  if (!preset) {
    return null;
  }
  const module = controlModuleIn(modules, preset.moduleId);
  if (!module || !module.renderer) {
    return null;
  }
  const room = resolveRoom(preset, slot);
  return {
    slot,
    preset,
    module,
    driver: preset.driverId ? controlModuleIn(modules, preset.driverId) : null,
    roomId: room.roomId,
    roomInherited: room.inherited,
  };
}

/** Every slot on a surface, resolved and in order, with the unusable ones dropped. */
export function resolvedSurface(
  controls: ControlsConfig,
  surface: ControlSlotSurface,
  modules: readonly ControlModule[],
): ResolvedSlot[] {
  const resolved: ResolvedSlot[] = [];
  for (const slot of slotsForSurface(controls, surface)) {
    const item = resolveSlot(slot, controls.presets, modules);
    if (item) {
      resolved.push(item);
    }
  }
  return resolved;
}

export function quickAccessSlots(controls: ControlsConfig, modules: readonly ControlModule[]): ResolvedSlot[] {
  return resolvedSurface(controls, "quick-access", modules);
}

export function nextSlotId(surface: ControlSlotSurface, presetId: string, existing: readonly ControlSlot[]): string {
  const base = `${surface.replace(/[^a-z0-9-]/g, "-")}-${presetId}`.slice(0, 50);
  const taken = new Set(existing.map((slot) => slot.id));
  if (!taken.has(base)) {
    return base;
  }
  for (let index = 2; index < 500; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now().toString(36)}`;
}
