"use client";

import { Dumbbell } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ORB_INFO_MODULES,
  ORB_MODULE_GROUP_LABELS,
  orbModuleById,
} from "../../lib/orb-info/catalogue";
import {
  normalizeOrbDisplay,
  resolveOrbDisplay,
  resolveOrbModuleId,
  resolveOrbParams,
} from "../../lib/orb-info/preferences";
import type {
  OrbDisplayUnit,
  OrbInfoDisplay,
  OrbInfoFormat,
  OrbInfoPreferences,
  OrbModuleParams,
  OrbRounding,
} from "../../lib/orb-info/types";
import {
  GYM_ALERT_THRESHOLD_DEFAULT_HOURS,
  GYM_ALERT_THRESHOLD_MAX_HOURS,
  GYM_ALERT_THRESHOLD_MIN_HOURS,
  normalizeGymAlertThresholdHours,
} from "../../lib/watchface-preferences";
import { CheckboxRow, ConfigAccordion, SliderControlPanel } from "./ConfigControls";
import { ConfigSelect, type ConfigSelectOption } from "./ConfigSelect";
import { ORB_INFO_CHANGE_EVENT, useOrbInfo } from "./orb-info/useOrbInfo";
import { useSettingCooldown } from "./useSettingCooldown";

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
  const [preferences, setPreferences] = useState<OrbInfoPreferences | undefined>(undefined);
  const [thresholdHours, setThresholdHours] = useState(() =>
    normalizeGymAlertThresholdHours(initialSettings?.gymAlertThresholdHours ?? GYM_ALERT_THRESHOLD_DEFAULT_HOURS));
  // Don't let the polls overwrite a control while (or just after) it's used.
  const { isCoolingDown, markInteraction } = useSettingCooldown();

  const moduleId = resolveOrbModuleId(preferences);
  const module = orbModuleById(moduleId);
  const display = resolveOrbDisplay(preferences, moduleId);
  const params = resolveOrbParams(preferences, moduleId);
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

  const save = useCallback(async (next: OrbInfoPreferences) => {
    markInteraction();
    try {
      const response = await fetch("/api/orb-info", {
        body: JSON.stringify(next),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Status orb info update failed: ${response.status}`);
      }
      const data = await response.json() as { orbInfo?: OrbInfoPreferences };
      setPreferences(data.orbInfo);
      window.dispatchEvent(new CustomEvent(ORB_INFO_CHANGE_EVENT));
    } catch (error) {
      console.error("[nova-dashboard] failed to update status orb info settings", error);
    }
  }, [markInteraction]);

  const selectModule = useCallback((nextId: string) => {
    markInteraction();
    setPreferences((current) => ({ ...current, moduleId: nextId }));
    void save({ moduleId: nextId });
  }, [markInteraction, save]);

  const updateDisplay = useCallback((patch: Partial<OrbInfoDisplay>) => {
    markInteraction();
    const next = normalizeOrbDisplay({ ...display, ...patch }, module.defaultDisplay);
    setPreferences((current) => ({
      ...current,
      modules: { ...(current?.modules ?? {}), [module.id]: { ...current?.modules?.[module.id], display: next } },
    }));
    // Only this module's entry is sent; the server merges it into the map so
    // the other modules' saved displays survive.
    void save({ modules: { [module.id]: { display: next } } });
  }, [display, markInteraction, module, save]);

  const updateParams = useCallback((patch: OrbModuleParams) => {
    markInteraction();
    const next = { ...params, ...patch };
    setPreferences((current) => ({
      ...current,
      modules: {
        ...(current?.modules ?? {}),
        [module.id]: { ...current?.modules?.[module.id], params: next },
      },
    }));
    void save({ modules: { [module.id]: { display, params: next } } });
  }, [display, markInteraction, module, params, save]);

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
        <ConfigSelect
          label="Readout"
          ariaLabel="Status orb readout module"
          options={moduleOptions}
          value={moduleId}
          onChange={selectModule}
        />

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
                    onPreview={(next) => updateParams({ [spec.key]: next })}
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
                  onPreview={(value) => updateDisplay({ decimals: Math.round(value) as OrbInfoDisplay["decimals"] })}
                  onCommit={(value) => updateDisplay({ decimals: Math.round(value) as OrbInfoDisplay["decimals"] })}
                />
                <ConfigSelect
                  label="Rounding"
                  ariaLabel="Rounding direction"
                  options={options(["floor", "round", "ceil"] as OrbRounding[], ROUNDING_LABELS)}
                  value={display.rounding}
                  onChange={(rounding) => updateDisplay({ rounding })}
                />
                <CheckboxRow
                  checked={display.showUnit}
                  label="Show Unit"
                  onChange={(showUnit) => updateDisplay({ showUnit })}
                />
                <CheckboxRow
                  checked={display.signed}
                  label="Show Sign"
                  onChange={(signed) => updateDisplay({ signed })}
                />
              </>
            ) : null}

            {showPercentControls ? (
              <>
                <CheckboxRow
                  checked={display.percentClamp}
                  label="Cap At 100%"
                  onChange={(percentClamp) => updateDisplay({ percentClamp })}
                />
                <CheckboxRow
                  checked={display.percentInvert}
                  label="Count Down"
                  onChange={(percentInvert) => updateDisplay({ percentInvert })}
                />
              </>
            ) : null}

            {display.format === "clock" ? (
              <>
                <CheckboxRow
                  checked={display.clock12Hour}
                  label="12 Hour"
                  onChange={(clock12Hour) => updateDisplay({ clock12Hour })}
                />
                <CheckboxRow
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
      </div>
    </ConfigAccordion>
  );
}
