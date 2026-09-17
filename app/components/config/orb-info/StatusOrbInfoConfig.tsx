"use client";

import { Dumbbell } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ORB_INFO_MODULES,
  ORB_MODULE_GROUP_LABELS,
  orbModuleById,
} from "../../../../lib/orb-info/catalogue";
import {
  normalizeOrbDisplay,
  resolveOrbDisplay,
  resolveOrbEntries,
  resolveOrbParams,
} from "../../../../lib/orb-info/preferences";
import type {
  OrbInfoDisplay,
  OrbInfoPreferences,
  OrbModuleParams,
  OrbStackEntry,
} from "../../../../lib/orb-info/types";
import {
  GYM_ALERT_THRESHOLD_DEFAULT_HOURS,
  normalizeGymAlertThresholdHours,
} from "../../../../lib/watchface-preferences";
import { ConfigAccordion } from "../../ConfigControls";
import { ConfigSelect, type ConfigSelectOption } from "../../ConfigSelect";
import { ORB_INFO_CHANGE_EVENT, useOrbInfo } from "../../orb-info/useOrbInfo";
import { useSettingCooldown } from "../../useSettingCooldown";
import { normalizeTimerIcons, type TimerIcon } from "../../../../lib/orb-timer-settings";
import { OrbEntryEditor } from "./OrbEntryEditor";
import { OrbEntryRow } from "./OrbEntryRow";
import { TimerTypeList } from "./TimerTypeList";
import type { GymCounterSettings } from "./types";

export function StatusOrbInfoConfig({ initialSettings }: { initialSettings?: GymCounterSettings | null }) {
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveVersion = useRef(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<OrbInfoPreferences | undefined>(undefined);
  const [thresholdHours, setThresholdHours] = useState(() =>
    normalizeGymAlertThresholdHours(initialSettings?.gymAlertThresholdHours ?? GYM_ALERT_THRESHOLD_DEFAULT_HOURS));
  // Don't let the polls overwrite a control while (or just after) it's used.
  const { isCoolingDown, markInteraction } = useSettingCooldown();

  const entries = useMemo(() => resolveOrbEntries(preferences), [preferences]);
  const [editingIcon, setEditingIcon] = useState<string | null>(null);
  const timerIcons = normalizeTimerIcons(preferences?.timerIcons);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const selected = selectedId === "" ? undefined : entries.find((entry) => entry.id === selectedId) ?? entries[0];
  const moduleId = selected?.moduleId ?? "none";
  const entryPreferences = { modules: { [moduleId]: selected ?? {} } };
  const module = orbModuleById(moduleId);
  const display = resolveOrbDisplay(entryPreferences, moduleId);
  const params = resolveOrbParams(entryPreferences, moduleId);
  // The preview runs the real modules through the real formatter, so what is
  // shown here is exactly what the orb will draw.
  const preview = useOrbInfo({
    enabled: true,
    moduleIdOverride: moduleId,
    displayOverride: display,
    paramsOverride: params,
  });

  const load = useCallback(async () => {
    if (isCoolingDown()) return;
    try {
      const [orbResponse, watchfaceResponse] = await Promise.all([
        fetch("/api/orb-info", { cache: "no-store" }),
        fetch("/api/watchface", { cache: "no-store" }),
      ]);
      if (orbResponse.ok) {
        const data = await orbResponse.json() as { orbInfo?: OrbInfoPreferences };
        if (!isCoolingDown()) setPreferences(data.orbInfo);
      }
      if (watchfaceResponse.ok) {
        const data = await watchfaceResponse.json() as { watchface?: GymCounterSettings };
        if (!isCoolingDown()) {
          setThresholdHours(normalizeGymAlertThresholdHours(
            data.watchface?.gymAlertThresholdHours ?? GYM_ALERT_THRESHOLD_DEFAULT_HOURS,
          ));
        }
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load status orb info settings", error);
    }
  }, [isCoolingDown]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(id);
  }, [load]);

  const save = useCallback((next: OrbInfoPreferences) => {
    markInteraction();
    const version = ++saveVersion.current;
    const operation = saveQueue.current.then(async () => {
      const response = await fetch("/api/orb-info", {
        body: JSON.stringify(next), headers: { "Content-Type": "application/json" }, method: "POST",
      });
      if (!response.ok) throw new Error(`Status orb info update failed: ${response.status}`);
      const data = await response.json() as { orbInfo?: OrbInfoPreferences };
      if (version === saveVersion.current) { setPreferences(data.orbInfo); setSaveError(null); }
      window.dispatchEvent(new CustomEvent(ORB_INFO_CHANGE_EVENT));
    });
    saveQueue.current = operation.catch((error) => setSaveError(error.message));
    return saveQueue.current;
  }, [markInteraction]);

  const saveEntries = (next: OrbStackEntry[]) => {
    markInteraction();
    setPreferences((current) => ({ ...current, entries: next }));
    void save({ entries: next });
  };
  const saveIcons = (timerIcons: TimerIcon[]) => {
    setPreferences((current) => ({ ...current, timerIcons }));
    void save({ timerIcons });
  };
  const selectModule = (nextId: string) => {
    const id = crypto.randomUUID();
    saveEntries([...entries, { id, moduleId: nextId, enabled: true }]);
    setSelectedId(id);
  };
  const updateEntry = (patch: Partial<OrbStackEntry>, persist = true) => {
    if (!selected) return;
    const next = entries.map((entry) => entry.id === selected.id ? { ...entry, ...patch } : entry);
    if (persist) saveEntries(next);
    else { markInteraction(); setPreferences((current) => ({ ...current, entries: next })); }
  };
  const updateDisplay = (patch: Partial<OrbInfoDisplay>, persist = true) => updateEntry({ display: normalizeOrbDisplay({ ...display, ...patch }, module.defaultDisplay) }, persist);
  const updateParams = (patch: OrbModuleParams, persist = true) => updateEntry({ params: { ...params, ...patch } }, persist);
  const moveEntry = (from: number, to: number) => {
    if (to < 0 || to >= entries.length || from < 0 || from === to) return;
    const next = [...entries]; next.splice(to, 0, next.splice(from, 1)[0]); saveEntries(next);
  };

  const commitThresholdHours = useCallback(async (hours: number) => {
    markInteraction();
    const normalized = normalizeGymAlertThresholdHours(hours);
    setThresholdHours(normalized);
    try {
      const response = await fetch("/api/watchface", {
        body: JSON.stringify({ gymAlertThresholdHours: normalized }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Gym counter settings update failed: ${response.status}`);
      }
      const data = await response.json() as { watchface?: GymCounterSettings };
      if (data.watchface?.gymAlertThresholdHours !== undefined) {
        setThresholdHours(normalizeGymAlertThresholdHours(data.watchface.gymAlertThresholdHours));
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to update gym counter settings", error);
    }
  }, [markInteraction]);

  const moduleOptions = useMemo<ConfigSelectOption<string>[]>(
    () => ORB_INFO_MODULES.map((entry) => ({
      value: entry.id,
      label: entry.label,
      detail: entry.detail,
      group: ORB_MODULE_GROUP_LABELS[entry.group],
    })),
    [],
  );

  const entryEditor = <OrbEntryEditor
    commitThresholdHours={commitThresholdHours}
    display={display}
    markInteraction={markInteraction}
    module={module}
    params={params}
    preview={preview}
    selected={selected}
    setThresholdHours={setThresholdHours}
    thresholdHours={thresholdHours}
    updateDisplay={updateDisplay}
    updateEntry={updateEntry}
    updateParams={updateParams}
  />;

  return (
    <ConfigAccordion
      id="status-orb-info"
      title="Status Orb Info"
      icon={<Dumbbell className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />

      <div className="grid gap-4">
        <p className="text-sm text-neutral-400">Alerts first, then countdowns by time left, then enabled rows in this order.</p>
        <div className="grid gap-2" aria-label="Status orb priority stack">
          {entries.map((entry, index) => <OrbEntryRow
            key={entry.id}
            dragId={dragId}
            entries={entries}
            entry={entry}
            entryEditor={entryEditor}
            index={index}
            moveEntry={moveEntry}
            saveEntries={saveEntries}
            selected={selected}
            setDragId={setDragId}
            setSelectedId={setSelectedId}
          />)}
        </div>
        {saveError && <p role="alert">{saveError}</p>}
        <ConfigSelect
          label="Add entry"
          ariaLabel="Status orb readout module"
          options={moduleOptions}
          value=""
          onChange={selectModule}
        />

        <TimerTypeList
          editingIcon={editingIcon}
          saveIcons={saveIcons}
          setEditingIcon={setEditingIcon}
          timerIcons={timerIcons}
        />
      </div>
    </ConfigAccordion>
  );
}
