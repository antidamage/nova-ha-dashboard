"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { newPreset } from "../../../../lib/control-modules/preset-draft";
import { HOME_ZONE_ID } from "../../../../lib/control-modules/rooms";
import { nextSlotId } from "../../../../lib/control-modules/slots";
import type { ControlPreset, ControlsConfig } from "../../../../lib/control-modules/types";
import { loadControlModules, saveControlModules, type ControlModulesPayload } from "./control-modules-client";

/**
 * The Devices tab's state machine (specs/control-modules.md).
 *
 * Edits save themselves, and the in-flight counter is what makes that safe: two
 * quick changes are two writes, and a reply that carries an older list must not
 * overwrite the newer one on screen. Same shape as the managed-computers panel's
 * autosave, for the same reason.
 */
export function useControlModules() {
  const [payload, setPayload] = useState<ControlModulesPayload | null>(null);
  const [controls, setControls] = useState<ControlsConfig>({ presets: [], slots: [] });
  const [message, setMessage] = useState<string | null>(null);
  const controlsRef = useRef<ControlsConfig>({ presets: [], slots: [] });
  const requestedSaveRef = useRef(0);
  const completedSaveRef = useRef(0);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const loaded = await loadControlModules();
      controlsRef.current = loaded.controls;
      setControls(loaded.controls);
      setPayload(loaded);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read the control configuration");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flushSaves = useCallback(async () => {
    if (savingRef.current) {
      return;
    }
    savingRef.current = true;
    try {
      while (completedSaveRef.current < requestedSaveRef.current) {
        const version = requestedSaveRef.current;
        const snapshot = controlsRef.current;
        try {
          const saved = await saveControlModules(snapshot);
          completedSaveRef.current = version;
          setPayload((current) => current && { ...current, controls: saved.controls, derived: saved.derived, problems: saved.problems });
          if (version === requestedSaveRef.current) {
            controlsRef.current = saved.controls;
            setControls(saved.controls);
            setMessage(saved.problems.some((problem) => problem.severity === "warning") ? "Saved. Some presets are still missing a device." : "Saved.");
          }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Could not save the control configuration");
          break;
        }
      }
    } finally {
      savingRef.current = false;
    }
  }, []);

  /** Replace the whole list and write it. Every mutation goes through here. */
  const apply = useCallback((next: ControlsConfig) => {
    controlsRef.current = next;
    setControls(next);
    requestedSaveRef.current += 1;
    void flushSaves();
  }, [flushSaves]);

  const addPreset = useCallback((moduleId: string) => {
    const module = payload?.modules.find((candidate) => candidate.id === moduleId);
    if (!module) {
      return;
    }
    const preset = newPreset(module, payload?.modules ?? [], controlsRef.current.presets);
    apply({ ...controlsRef.current, presets: [...controlsRef.current.presets, preset] });
    return preset.id;
  }, [apply, payload]);

  const updatePreset = useCallback((presetId: string, updater: (preset: ControlPreset) => ControlPreset) => {
    apply({
      ...controlsRef.current,
      presets: controlsRef.current.presets.map((preset) => (preset.id === presetId ? updater(preset) : preset)),
    });
  }, [apply]);

  const removePreset = useCallback((presetId: string) => {
    apply({
      presets: controlsRef.current.presets.filter((preset) => preset.id !== presetId),
      // A slot pointing at a deleted preset would render nothing forever, so it
      // goes with the preset rather than leaving a hole on the card.
      slots: controlsRef.current.slots.filter((slot) => slot.presetId !== presetId),
    });
  }, [apply]);

  const placePreset = useCallback((presetId: string) => {
    if (controlsRef.current.slots.some((slot) => slot.surface === "quick-access" && slot.presetId === presetId)) {
      return;
    }
    apply({
      presets: controlsRef.current.presets,
      slots: [
        ...controlsRef.current.slots,
        {
          id: nextSlotId("quick-access", presetId, controlsRef.current.slots),
          presetId,
          // Quick Access sits on the home surface, so a preset that inherits its
          // room inherits the Home zone — not `null`, which would resolve to no
          // zone at all and silently drop a lighting control off the card.
          roomId: HOME_ZONE_ID,
          surface: "quick-access",
          visible: true,
        },
      ],
    });
  }, [apply]);

  const unplacePreset = useCallback((slotId: string) => {
    apply({ presets: controlsRef.current.presets, slots: controlsRef.current.slots.filter((slot) => slot.id !== slotId) });
  }, [apply]);

  /** Move a slot one place up (-1) or down (+1) in the Quick Access row. */
  const moveSlot = useCallback((slotId: string, delta: number) => {
    const index = controlsRef.current.slots.findIndex((slot) => slot.id === slotId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= controlsRef.current.slots.length) {
      return;
    }
    const slots = [...controlsRef.current.slots];
    const [moved] = slots.splice(index, 1);
    slots.splice(target, 0, moved);
    apply({ presets: controlsRef.current.presets, slots });
  }, [apply]);

  /** Adopt the derived set as real configuration, so it stops being implicit. */
  const adoptDerived = useCallback(() => {
    if (!payload) {
      return;
    }
    apply({ ...payload.controls });
  }, [apply, payload]);

  return {
    addPreset,
    adoptDerived,
    apply,
    controls,
    derived: payload?.derived ?? true,
    entities: payload?.entities ?? [],
    message,
    modules: payload?.modules ?? [],
    moveSlot,
    placePreset,
    problems: payload?.problems ?? [],
    reload: load,
    removePreset,
    rooms: payload?.rooms ?? [],
    unplacePreset,
    updatePreset,
  };
}