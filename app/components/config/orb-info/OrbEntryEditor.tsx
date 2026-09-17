"use client";

import { useMemo } from "react";
import { ConfigSelect, type ConfigSelectOption } from "../../ConfigSelect";
import { SliderControlPanel } from "../../ConfigControls";
import { SwitchRow } from "../../SlideSwitch";
import { isCountdownModule } from "../../../../lib/orb-info/stack";
import {
  GYM_ALERT_THRESHOLD_MAX_HOURS,
  GYM_ALERT_THRESHOLD_MIN_HOURS,
} from "../../../../lib/watchface-preferences";
import type {
  OrbDisplayUnit,
  OrbInfoDisplay,
  OrbModule,
  OrbModuleParams,
  OrbRounding,
  OrbStackEntry,
} from "../../../../lib/orb-info/types";
import type { useOrbInfo } from "../../orb-info/useOrbInfo";
import { DURATION_UNITS, FORMAT_LABELS, ROUNDING_LABELS, UNIT_LABELS } from "./constants";
import { options } from "./select-option-model";

// The per-entry settings shown under the selected row: the module's own params,
// then the readout's format, unit, rounding and sign controls.
export function OrbEntryEditor({
  commitThresholdHours,
  display,
  markInteraction,
  module,
  params,
  preview,
  selected,
  setThresholdHours,
  thresholdHours,
  updateDisplay,
  updateEntry,
  updateParams,
}: {
  commitThresholdHours: (hours: number) => Promise<void>;
  display: OrbInfoDisplay;
  markInteraction: () => void;
  module: OrbModule;
  params: OrbModuleParams;
  preview: ReturnType<typeof useOrbInfo>;
  selected: OrbStackEntry | undefined;
  setThresholdHours: (hours: number) => void;
  thresholdHours: number;
  updateDisplay: (patch: Partial<OrbInfoDisplay>, persist?: boolean) => void;
  updateEntry: (patch: Partial<OrbStackEntry>, persist?: boolean) => void;
  updateParams: (patch: OrbModuleParams, persist?: boolean) => void;
}) {
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
    <div className="grid gap-4">
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
    </div>
  );
}
