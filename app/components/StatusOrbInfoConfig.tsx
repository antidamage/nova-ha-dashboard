"use client";

import { Dumbbell, GripVertical, ArrowUp, ArrowDown, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ORB_INFO_MODULES,
  ORB_MODULE_GROUP_LABELS,
  orbModuleById,
} from "../../lib/orb-info/catalogue";
import {
  normalizeOrbDisplay,
  resolveOrbDisplay,
  resolveOrbEntries,
  resolveOrbParams,
} from "../../lib/orb-info/preferences";
import type {
  OrbDisplayUnit,
  OrbInfoDisplay,
  OrbInfoFormat,
  OrbInfoPreferences,
  OrbModuleParams,
  OrbRounding,
  OrbStackEntry,
} from "../../lib/orb-info/types";
import {
  GYM_ALERT_THRESHOLD_DEFAULT_HOURS,
  GYM_ALERT_THRESHOLD_MAX_HOURS,
  GYM_ALERT_THRESHOLD_MIN_HOURS,
  normalizeGymAlertThresholdHours,
} from "../../lib/watchface-preferences";
import { ConfigAccordion, SliderControlPanel } from "./ConfigControls";
import { ConfigSelect, type ConfigSelectOption } from "./ConfigSelect";
import { ORB_INFO_CHANGE_EVENT, useOrbInfo } from "./orb-info/useOrbInfo";
import { useSettingCooldown } from "./useSettingCooldown";
import { normalizeTimerIcons, type TimerIcon } from "../../lib/orb-timer-settings";
import { ReminderIconPicker } from "./reminders/ReminderIconPicker";
import { ReminderGlyphMark } from "./reminders/icon-registry";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import { SlideSwitch, SwitchRow } from "./SlideSwitch";
import { isCountdownModule } from "../../lib/orb-info/stack";

type GymCounterSettings = {
  gymAlertThresholdHours?: number;
};

const FORMAT_LABELS: Record<OrbInfoFormat, string> = {
  number: "Number",
  duration: "Duration",
  percent: "Percentage",
  clock: "Clock",
  temperature: "Temperature",
  text: "Text",
};

const DURATION_UNITS: OrbDisplayUnit[] = ["auto", "seconds", "minutes", "hours", "days", "weeks"];
const UNIT_LABELS: Partial<Record<OrbDisplayUnit, string>> = {
  auto: "Automatic",
  seconds: "Seconds",
  minutes: "Minutes",
  hours: "Hours",
  days: "Days",
  weeks: "Weeks",
  celsius: "Celsius",
  fahrenheit: "Fahrenheit",
  watts: "Watts",
  kilowatts: "Kilowatts",
};
const ROUNDING_LABELS: Record<OrbRounding, string> = {
  floor: "Down",
  round: "Nearest",
  ceil: "Up",
};

function options<T extends string>(values: T[], labels: Partial<Record<T, string>>): ConfigSelectOption<T>[] {
  return values.map((value) => ({ value, label: labels[value] ?? value }));
}

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

  const formatOptions = useMemo(
    () => options(module.supportedFormats, FORMAT_LABELS),
    [module],
  );

  const showUnitPicker = display.format === "duration" || display.format === "temperature"
    || (display.format === "number" && module.baseUnit === "watts");
  const unitChoices: OrbDisplayUnit[] = display.format === "duration"
    ? DURATION_UNITS
    : display.format === "temperature"
      ? ["celsius", "fahrenheit"]
      : ["watts", "kilowatts"];
  const showNumberControls = display.format !== "text" && display.format !== "clock";
  const showPercentControls = display.format === "percent";
  const usesThreshold = module.id.startsWith("gym");

  const entryEditor = <div className="grid gap-4">
        {selected && !isCountdownModule(selected.moduleId) && !["power-high", "update-running"].includes(selected.moduleId) && <SwitchRow
          checked={selected.showOnlyWhenAlerting === true} label="Only When Alerting"
          onChange={(showOnlyWhenAlerting) => updateEntry({ showOnlyWhenAlerting })} />}
        {module.id === "none" ? null : (
          <>
            <div className="orb-info-preview" aria-live="polite">
              <span className="orb-info-preview-label">Preview</span>
              <span className="orb-info-preview-value">{preview.text}</span>
            </div>

            {(module.params ?? []).map((spec) => {
              if (spec.kind === "number") {
                const value = Number(params[spec.key] ?? spec.fallback);
                return (
                  <SliderControlPanel
                    key={spec.key}
                    ariaLabel={spec.label}
                    ariaValueText={`${value}`}
                    color={[60, 220, 240]}
                    intensity={100}
                    label={spec.label}
                    max={spec.max}
                    min={spec.min}
                    step={spec.step}
                    value={value}
                    valueText={`${value}`}
                    onPreview={(next) => updateParams({ [spec.key]: next }, false)}
                    onCommit={(next) => updateParams({ [spec.key]: next })}
                  />
                );
              }
              if (spec.kind === "date") {
                return (
                  <div key={spec.key} className="grid gap-2">
                    <p className="text-sm font-black uppercase text-cyan-200">{spec.label}</p>
                    <input
                      type="date"
                      className="cyber-date-input"
                      aria-label={spec.label}
                      value={typeof params[spec.key] === "string" ? String(params[spec.key]).slice(0, 10) : ""}
                      onChange={(event) => updateParams({ [spec.key]: event.target.value })}
                    />
                  </div>
                );
              }
              const choices: ConfigSelectOption<string>[] = spec.kind === "zone"
                ? preview.zoneChoices.map((zone) => ({ value: zone.id, label: zone.name }))
                : preview.entityChoices
                  .filter((entity) => !spec.domain || entity.entityId.startsWith(`${spec.domain}.`))
                  .map((entity) => ({
                    value: entity.entityId,
                    label: entity.name,
                    detail: entity.unit ? `${entity.value ?? "—"} ${entity.unit}` : undefined,
                  }));
              if (choices.length === 0) {
                return null;
              }
              return (
                <ConfigSelect
                  key={spec.key}
                  label={spec.label}
                  ariaLabel={spec.label}
                  options={choices}
                  value={typeof params[spec.key] === "string" ? String(params[spec.key]) : choices[0].value}
                  onChange={(next) => updateParams({ [spec.key]: next })}
                />
              );
            })}

            {formatOptions.length > 1 ? (
              <ConfigSelect
                label="Format"
                ariaLabel="Readout format"
                options={formatOptions}
                value={display.format}
                onChange={(format) => updateDisplay({ format })}
              />
            ) : null}

            {showUnitPicker ? (
              <ConfigSelect
                label="Unit"
                ariaLabel="Readout unit"
                options={options(unitChoices, UNIT_LABELS)}
                value={display.unit}
                onChange={(unit) => updateDisplay({ unit })}
              />
            ) : null}

            {showNumberControls ? (
              <>
                <SliderControlPanel
                  ariaLabel="Decimal places"
                  ariaValueText={`${display.decimals} decimal places`}
                  color={[60, 220, 240]}
                  intensity={100}
                  label="Decimals"
                  max={3}
                  min={0}
                  step={1}
                  value={display.decimals}
                  valueText={`${display.decimals}`}
                  onPreview={(value) => updateDisplay({ decimals: Math.round(value) as OrbInfoDisplay["decimals"] }, false)}
                  onCommit={(value) => updateDisplay({ decimals: Math.round(value) as OrbInfoDisplay["decimals"] })}
                />
                <ConfigSelect
                  label="Rounding"
                  ariaLabel="Rounding direction"
                  options={options(["floor", "round", "ceil"] as OrbRounding[], ROUNDING_LABELS)}
                  value={display.rounding}
                  onChange={(rounding) => updateDisplay({ rounding })}
                />
                <SwitchRow
                  checked={display.showUnit}
                  label="Show Unit"
                  onChange={(showUnit) => updateDisplay({ showUnit })}
                />
                <SwitchRow
                  checked={display.signed}
                  label="Show Sign"
                  onChange={(signed) => updateDisplay({ signed })}
                />
              </>
            ) : null}

            {showPercentControls ? (
              <>
                <SwitchRow
                  checked={display.percentClamp}
                  label="Cap At 100%"
                  onChange={(percentClamp) => updateDisplay({ percentClamp })}
                />
                <SwitchRow
                  checked={display.percentInvert}
                  label="Count Down"
                  onChange={(percentInvert) => updateDisplay({ percentInvert })}
                />
              </>
            ) : null}

            {display.format === "clock" ? (
              <>
                <SwitchRow
                  checked={display.clock12Hour}
                  label="12 Hour"
                  onChange={(clock12Hour) => updateDisplay({ clock12Hour })}
                />
                <SwitchRow
                  checked={display.clockSeconds}
                  label="Show Seconds"
                  onChange={(clockSeconds) => updateDisplay({ clockSeconds })}
                />
              </>
            ) : null}

            {usesThreshold ? (
              <SliderControlPanel
                ariaLabel="Gym alert threshold"
                ariaValueText={`${thresholdHours} hours`}
                color={[60, 220, 240]}
                intensity={100}
                label="Alert Hours"
                max={GYM_ALERT_THRESHOLD_MAX_HOURS}
                min={GYM_ALERT_THRESHOLD_MIN_HOURS}
                step={1}
                value={thresholdHours}
                valueText={`${thresholdHours}h`}
                onPreview={(value) => {
                  markInteraction();
                  setThresholdHours(value);
                }}
                onCommit={commitThresholdHours}
              />
            ) : null}
          </>
        )}
  </div>;

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
          {entries.map((entry, index) => { const countdown = isCountdownModule(entry.moduleId); return <div key={entry.id} className="grid gap-3" data-orb-entry-kind={countdown ? "countdown" : "ordered"}
            onDragOver={countdown ? undefined : (event) => event.preventDefault()}
            onDrop={countdown ? undefined : (event) => { event.preventDefault(); moveEntry(entries.findIndex((row) => row.id === dragId), index); setDragId(null); }}>
            <div className="flex items-center gap-2">
            {countdown
              ? <span className="config-icon-button text-xs font-black uppercase" title="Countdowns order by time left">Countdown</span>
              : <MomentaryFeedbackButton draggable onDragStart={() => setDragId(entry.id)} aria-label={`Drag ${orbModuleById(entry.moduleId).label}`} className="config-icon-button"><GripVertical size={18} /></MomentaryFeedbackButton>}
            <MomentaryFeedbackButton onClick={() => setSelectedId(selected?.id === entry.id ? "" : entry.id)} aria-expanded={selected?.id === entry.id} className="flex-1 text-left">{orbModuleById(entry.moduleId).label}</MomentaryFeedbackButton>
            {!countdown && <SlideSwitch label={`Enable ${orbModuleById(entry.moduleId).label}`} checked={entry.enabled !== false}
              onChange={() => saveEntries(entries.map((row) => row.id === entry.id ? { ...row, enabled: row.enabled === false } : row))} />}
            {!countdown && <MomentaryFeedbackButton aria-label="Move entry up" disabled={index === 0} onClick={() => moveEntry(index, index - 1)}><ArrowUp size={18} /></MomentaryFeedbackButton>}
            {!countdown && <MomentaryFeedbackButton aria-label="Move entry down" disabled={index === entries.length - 1} onClick={() => moveEntry(index, index + 1)}><ArrowDown size={18} /></MomentaryFeedbackButton>}
            <MomentaryFeedbackButton aria-label="Remove entry" onClick={() => saveEntries(entries.filter((row) => row.id !== entry.id))}><X size={18} /></MomentaryFeedbackButton>
            </div>
            {selected?.id === entry.id && entryEditor}
          </div>; })}
        </div>
        {saveError && <p role="alert">{saveError}</p>}
        <ConfigSelect
          label="Add entry"
          ariaLabel="Status orb readout module"
          options={moduleOptions}
          value=""
          onChange={selectModule}
        />

        <div className="grid gap-2">
          <p className="text-sm font-black uppercase">Timer types</p>
          {timerIcons.map((icon, index) => <div key={icon.id} className="flex items-center gap-2">
            <MomentaryFeedbackButton className="h-10 w-10" aria-label={`Choose ${icon.label} icon`} onClick={() => setEditingIcon(icon.id)}><ReminderGlyphMark glyph={icon.glyph} /></MomentaryFeedbackButton>
            <input aria-label="Timer type name" className="cyber-date-input" defaultValue={icon.label} key={`${icon.id}-${icon.label}`} onBlur={(event) => saveIcons(timerIcons.map((item) => item.id === icon.id ? { ...item, label: event.target.value.trim() || item.label } : item))} />
            <MomentaryFeedbackButton aria-label="Move timer type up" disabled={!index} onClick={() => { const next = [...timerIcons]; [next[index-1], next[index]] = [next[index], next[index-1]]; saveIcons(next); }}>Up</MomentaryFeedbackButton>
            <MomentaryFeedbackButton aria-label="Remove timer type" disabled={timerIcons.length === 1} onClick={() => saveIcons(timerIcons.filter((item) => item.id !== icon.id))}>Remove</MomentaryFeedbackButton>
            <ReminderIconPicker glyph={icon.glyph} open={editingIcon === icon.id} reminderName={icon.label} onClose={() => setEditingIcon(null)} onSelect={(glyph) => { saveIcons(timerIcons.map((item) => item.id === icon.id ? { ...item, glyph } : item)); setEditingIcon(null); }} />
          </div>)}
          <MomentaryFeedbackButton onClick={() => saveIcons([...timerIcons, { id: crypto.randomUUID(), label: "Timer", glyph: { kind: "phosphor", id: "timer" } }])}>Add timer type</MomentaryFeedbackButton>
        </div>
      </div>
    </ConfigAccordion>
  );
}
