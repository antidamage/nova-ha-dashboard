"use client";

import { Activity, AudioLines, Clock3, Dice5, Music2, Plus, Sparkles, Trash2, Waves, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { PhonoscopeDriver, PhonoscopeDriverType, PhonoscopePulseType } from "../../../lib/types";
import { phonoscopeDriver } from "../../../lib/phonoscope-drivers";
import { ConfigSelect } from "../ConfigSelect";
import { SliderControlPanel } from "../ConfigControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import {
  DRIVER_TYPES,
  cadenceChoices,
  cadenceValue,
  driverSupportsCycle,
  driverTypeLabel,
  ordinal,
} from "./effectCatalogue";

const DRIVER_ICONS: Record<PhonoscopeDriverType, ReactNode> = {
  beat: <Activity />,
  downbeat: <AudioLines />,
  timer: <Clock3 />,
  song: <Music2 />,
  energy: <Zap />,
  bass: <Waves />,
  mid: <AudioLines />,
  treble: <Sparkles />,
  random: <Dice5 />,
};

const PULSE_TYPES: PhonoscopePulseType[] = ["beat", "downbeat", "timer", "song"];

/**
 * One driver row: what it runs on, and — for a counted pulse — how often.
 *
 * The meta-beat is two small controls rather than a long flat list of "every
 * Nth" driver names: pick the pulse, then pick the cycle. It reads the way the
 * lane header reads, and it extends without new entries.
 */
export function DriverRow({
  driver,
  label,
  onChange,
  onRemove,
}: {
  driver: PhonoscopeDriver;
  label: string;
  onChange: (driver: PhonoscopeDriver) => void;
  onRemove?: () => void;
}) {
  const showsCycle = driverSupportsCycle(driver);
  // `random` already spends a column on "Re-samples on", so its cycle controls
  // go on their own row rather than crowding four selects onto one.
  const cycleOnOwnRow = driver.type === "random";
  const choices = cadenceChoices(driver);
  const cycleControls = showsCycle ? (
    <>
      <ConfigSelect
        label="Every"
        value={cadenceValue(driver)}
        options={choices.map(({ value, label }) => ({ value, label }))}
        onChange={(value) => {
          const choice = choices.find((entry) => entry.value === value);
          onChange(phonoscopeDriver({
            ...driver,
            every: choice?.every ?? 1,
            divide: choice?.divide ?? 1,
          }));
        }}
      />
      {/*
        Faster than the pulse, "from the 2nd of eight sub-beats" is not a thing
        anyone can hear, so the offset control is simply absent — and
        `phonoscopeDriver` has already zeroed the value behind it.
      */}
      {driver.every > 1 ? (
        <ConfigSelect
          label="Starting on"
          value={String(driver.offset)}
          options={Array.from({ length: driver.every }, (_unused, index) => ({
            value: String(index),
            label: `the ${ordinal(index + 1)}`,
          }))}
          onChange={(value) => onChange(phonoscopeDriver({ ...driver, offset: Number(value) }))}
        />
      ) : null}
    </>
  ) : null;

  return (
    <div className="grid gap-2 border border-neutral-800 bg-neutral-950/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-black uppercase text-neutral-400">{label}</span>
        {onRemove ? (
          <MomentaryFeedbackButton
            type="button"
            className="icon-link text-red-200"
            aria-label={`Remove ${driverTypeLabel(driver.type)} driver`}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </MomentaryFeedbackButton>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <ConfigSelect
          label="Driver"
          value={driver.type}
          options={DRIVER_TYPES.map((type) => ({
            value: type,
            label: driverTypeLabel(type),
            icon: DRIVER_ICONS[type],
          }))}
          onChange={(type) => onChange(phonoscopeDriver({ ...driver, type }))}
        />
        {cycleOnOwnRow ? null : cycleControls}
        {driver.type === "random" ? (
          <ConfigSelect
            label="Fires within"
            value={driver.cadence}
            options={PULSE_TYPES.map((type) => ({
              value: type,
              label: driverTypeLabel(type),
              icon: DRIVER_ICONS[type],
            }))}
            onChange={(cadence) => onChange(phonoscopeDriver({ ...driver, cadence }))}
          />
        ) : null}
      </div>
      {cycleOnOwnRow && cycleControls ? (
        <div className="grid gap-2 sm:grid-cols-3">{cycleControls}</div>
      ) : null}
      {driver.type === "timer" || (driver.type === "random" && driver.cadence === "timer") ? (
        <SliderControlPanel
          ariaLabel="Timer interval"
          ariaValueText={`${driver.intervalSeconds} seconds`}
          color={[34, 211, 238]}
          label="Interval"
          min={0.25}
          max={120}
          step={0.25}
          value={driver.intervalSeconds}
          valueText={`${driver.intervalSeconds.toFixed(2)}s`}
          onPreview={(intervalSeconds) => onChange({ ...driver, intervalSeconds })}
          onCommit={(intervalSeconds) => onChange(phonoscopeDriver({ ...driver, intervalSeconds }))}
        />
      ) : null}
      {driver.type === "random" ? (
        <p className="text-xs text-neutral-500">
          Fires once somewhere inside each window, then picks a new moment for the next one. The
          shape of the hit is each effect&rsquo;s own envelope, the same as any other pulse.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The lane's driver stack: the main driver, then any modifiers inset beneath
 * it. Modifier signals are summed onto the main one, so "downbeat plus bass"
 * reads as the hit sitting on top of whatever the bass is already doing.
 */
export function DriverStack({
  driver,
  modifiers,
  onChange,
}: {
  driver: PhonoscopeDriver;
  modifiers: PhonoscopeDriver[];
  onChange: (driver: PhonoscopeDriver, modifiers: PhonoscopeDriver[]) => void;
}) {
  return (
    <div className="grid gap-2">
      <DriverRow driver={driver} label="Driver" onChange={(next) => onChange(next, modifiers)} />
      {/*
        Modifiers and their add button both live inside the inset rule, so it is
        visible at a glance that this button extends *this* lane's driver rather
        than starting a new lane. The two used to look alike and read alike, and
        "Add driver" was reasonably mistaken for "add a driver lane".
      */}
      <div className="grid gap-2 border-l border-neutral-800 pl-3">
        {modifiers.map((modifier, index) => (
          <DriverRow
            key={index}
            driver={modifier}
            label={`Added driver ${index + 1}`}
            onChange={(next) => onChange(driver,
              modifiers.map((entry, position) => position === index ? next : entry))}
            onRemove={() => onChange(driver, modifiers.filter((_entry, position) => position !== index))}
          />
        ))}
        {modifiers.length < 4 ? (
          <MomentaryFeedbackButton
            type="button"
            className="theme-library-button justify-center"
            onClick={() => onChange(driver, [...modifiers, phonoscopeDriver({ type: "bass" })])}
          >
            <Plus className="h-4 w-4" />
            Combine with another driver
          </MomentaryFeedbackButton>
        ) : null}
      </div>
    </div>
  );
}
