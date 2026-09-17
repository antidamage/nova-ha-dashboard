"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import type {
  PhonoscopeCombineMode,
  PhonoscopeDriver,
  PhonoscopeEffectBinding,
} from "../../../lib/types";
import {
  driverFiresEvents,
  PHONOSCOPE_PLAYBACK_ORDER_VALUES,
  PHONOSCOPE_THEME_CHANGE_EFFECT,
  phonoscopePlaybackOrder,
} from "../../../lib/phonoscope-drivers";
import { ConfigSelect } from "../ConfigSelect";
import {
  EnvelopeSliderControlPanel,
  RangeSliderControlPanel,
  SliderControlPanel,
} from "../ConfigControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { SwitchRow } from "../SlideSwitch";
import { effectNeedsPulseDriver } from "./driver-labels";
import {
  COMBINE_OPTIONS,
  hasParameter,
  type EffectEntryView,
  type ParameterKey,
} from "./effect-entry-model";
import { PlaybackOrderControl } from "./PlaybackOrderControl";
import { TransitionControl } from "./TransitionControl";
import type { EffectOption } from "./types";

/**
 * One added parameter, with the control to take it back off again.
 *
 * Removing a parameter is not the same as setting it to its default: it makes
 * the binding inherit, so a later change to the effect's declared default still
 * reaches this appearance.
 */
function ParameterRow({
  children,
  label,
  onRemove,
}: {
  children: ReactNode;
  label: string;
  onRemove: () => void;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <MomentaryFeedbackButton
          type="button"
          className="icon-link text-red-200"
          aria-label={`Remove ${label}, inherit the default`}
          title="Remove this override and inherit the default"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </MomentaryFeedbackButton>
      </div>
    </div>
  );
}

/**
 * The parameter controls an effect entry shows: the ones its binding carries,
 * each with its own remove button. Split out of `EffectEntry.tsx`
 * (specs/agent-token-footprint.md §4); the values below are the ones the entry
 * derived from its props.
 */
export function EffectEntryControls({
  binding,
  combine,
  driver,
  effect,
  onChange,
  onCombineChange,
  onCompanionChange,
  removeParameter,
  variant,
  view,
}: {
  binding: PhonoscopeEffectBinding;
  combine: PhonoscopeCombineMode | undefined;
  driver: PhonoscopeDriver;
  effect: EffectOption;
  onChange: (binding: PhonoscopeEffectBinding) => void;
  onCombineChange: (mode: PhonoscopeCombineMode) => void;
  onCompanionChange?: (effect: string, value: number) => void;
  removeParameter: (key: ParameterKey) => void;
  variant: "card" | "row";
  view: EffectEntryView;
}) {
  const {
    range, envelope, themePulse, fixedRange, overrideOnly, controlSet,
    companionValue, name, valueText,
  } = view;

  /**
   * A control's own remove button, which takes the OVERRIDE off and leaves the
   * effect in place. Inside a parameter group there is nothing to leave behind —
   * the parameter is the binding — so the group's row carries one X instead.
   */
  const wrap = (label: string, key: ParameterKey, node: ReactNode) =>
    variant === "row" ? node : (
      <ParameterRow label={label} onRemove={() => removeParameter(key)}>{node}</ParameterRow>
    );

  return (
    <>
      {effectNeedsPulseDriver(binding.effect) && !driverFiresEvents(driver) ? (
          <p className="text-xs text-amber-300">
            This lane&rsquo;s driver carries a level, not an event, so it will never advance the
            rotation. Use a beat, downbeat, timer, song or random driver.
          </p>
        ) : null}
        {binding.randomValue && !driverFiresEvents(driver) ? (
          <p className="text-xs text-amber-300">
            RND draws a new target each time the lane fires, and this lane&rsquo;s driver carries a
            level rather than firing, so it will draw once and hold. Use a beat, downbeat, timer,
            song or random driver.
          </p>
        ) : null}

        {controlSet ? (
          <TransitionControl
            binding={binding}
            companionValue={companionValue}
            envelope={envelope}
            onChange={onChange}
            onCompanionChange={(effectId, value) => onCompanionChange?.(effectId, value)}
          />
        ) : null}

        {!overrideOnly && variant !== "row" && hasParameter(binding, combine, "combine") ? wrap(
          "When stacked",
          "combine",
            <ConfigSelect
              label="When stacked"
              value={combine ?? "add"}
              options={COMBINE_OPTIONS}
              onChange={(mode) => onCombineChange(mode as PhonoscopeCombineMode)}
            />,
        ) : null}

        {binding.effect === PHONOSCOPE_THEME_CHANGE_EFFECT
          && hasParameter(binding, combine, "order") ? wrap(
          "Playback",
          "order",
            <PlaybackOrderControl
              value={phonoscopePlaybackOrder(binding.params?.order)}
              onChange={(order) => onChange({
                ...binding,
                params: {
                  ...(binding.params ?? {}),
                  order: PHONOSCOPE_PLAYBACK_ORDER_VALUES[order],
                },
              })}
            />,
        ) : null}

        {hasParameter(binding, combine, "range") && effect.toggle ? wrap(
          // A 0/1 axis reads as on or off. Both ends are pinned together, so it
          // is a state rather than something a driver sweeps.
          name,
          "range",
            <SwitchRow
              checked={range[0] >= 0.5}
              detail={effect.description}
              label={name}
              onChange={(checked) => onChange({
                ...binding,
                min: checked ? 1 : 0,
                max: checked ? 1 : 0,
              })}
            />,
        ) : null}

        {hasParameter(binding, combine, "range") && effect.choices && !fixedRange
          && !controlSet ? wrap(
          // A discrete axis is one choice, not a sweep: the way to change a
          // blend mode with the music is a second lane carrying its own glow,
          // so both ends of the range are pinned to the selected mode.
          name,
          "range",
            <ConfigSelect
              label={name}
              value={String(range[0])}
              options={effect.choices.map((choice) => ({
                value: String(choice.value),
                label: choice.label,
              }))}
              onChange={(value) =>
                onChange({ ...binding, min: Number(value), max: Number(value) })}
            />,
        ) : null}

        {hasParameter(binding, combine, "range") && effect.pinned && !fixedRange ? wrap(
          // Continuous, but ONE value rather than a sweep: a width is a width,
          // and a transition axis is latched for the whole run. Both ends of
          // the range sit on the chosen number.
          name,
          "range",
            <SliderControlPanel
              ariaLabel={name}
              ariaValueText={valueText(range[0])}
              snapRemote
              color={[34, 211, 238]}
              label={name}
              min={effect.min}
              max={effect.max}
              step={effect.step}
              value={range[0]}
              valueText={valueText(range[0])}
              onPreview={(value) => onChange({ ...binding, min: value, max: value })}
              onCommit={(value) => onChange({ ...binding, min: value, max: value })}
            />,
        ) : null}

        {hasParameter(binding, combine, "range") && !effect.choices && !effect.toggle
          && !effect.pinned && !fixedRange ? wrap(
          "Range",
          "range",
            <RangeSliderControlPanel
              ariaLabel={`${name} range`}
              label={variant === "row" ? name : "Minimum / Maximum"}
              min={effect.min}
              max={effect.max}
              step={effect.step}
              value={range}
              formatValue={(value) => value.toFixed(effect.step >= 1 ? 0 : 1)}
              random={binding.randomValue ?? false}
              onPreview={([min, max]) => onChange({ ...binding, min, max })}
              onCommit={([min, max]) => onChange({ ...binding, min, max })}
              onRandomChange={(randomValue) => {
                const next = { ...binding };
                // Off is absent, not false: the binding stays sparse.
                if (randomValue) next.randomValue = true;
                else delete next.randomValue;
                onChange(next);
              }}
            />,
        ) : null}

        {hasParameter(binding, combine, "envelope") && !effect.choices && !effect.pinned
          && variant !== "row" ? wrap(
          themePulse ? "Transition" : "Ramp",
          "envelope",
            <EnvelopeSliderControlPanel
              ariaLabel={`${name} ramp`}
              label={themePulse ? "Transition" : "Ramp"}
              value={envelope}
              onPreview={([attackSeconds, holdSeconds, releaseSeconds]) =>
                onChange({ ...binding, attackSeconds, holdSeconds, releaseSeconds })}
              onCommit={([attackSeconds, holdSeconds, releaseSeconds]) =>
                onChange({ ...binding, attackSeconds, holdSeconds, releaseSeconds })}
            />,
        ) : null}
    </>
  );
}
