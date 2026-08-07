"use client";

import { ArrowRight, Plus, Repeat, Shuffle, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import type {
  PhonoscopeCombineMode,
  PhonoscopeDriver,
  PhonoscopeEffectBinding,
} from "../../../lib/types";
import {
  driverFiresEvents,
  isPhonoscopeOverrideOnlyEffect,
  isPhonoscopeThemePulseEffect,
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_PLAYBACK_ORDER_VALUES,
  PHONOSCOPE_THEME_CHANGE_EFFECT,
  phonoscopePlaybackOrder,
  type PhonoscopePlaybackOrder,
} from "../../../lib/phonoscope-drivers";
import {
  PHONOSCOPE_PICTURE_EFFECTS,
  PHONOSCOPE_PICTURE_EFFECT_LABELS,
} from "../../../lib/phonoscope-effects";
import { ConfigSelect } from "../ConfigSelect";
import {
  CheckboxRow,
  ConfigAccordion,
  EnvelopeSliderControlPanel,
  RangeSliderControlPanel,
  SliderControlPanel,
} from "../ConfigControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import {
  CENTRE_TRANSITION_CHOICES,
  CENTRE_TRANSITION_COMPANIONS,
  effectGroupIndex,
  effectNeedsPulseDriver,
  type EffectOption,
  type ResolvedEffectGroup,
} from "./effectCatalogue";
import { CopyActions, PasteIntoButton } from "./ClipboardControls";

/** The optional parameters an effect entry can carry, in the order offered. */
type ParameterKey = "range" | "envelope" | "combine" | "order";

function hasParameter(
  binding: PhonoscopeEffectBinding,
  combine: PhonoscopeCombineMode | undefined,
  key: ParameterKey,
) {
  switch (key) {
    case "range": return binding.min !== undefined || binding.max !== undefined;
    case "envelope":
      return binding.attackSeconds !== undefined || binding.holdSeconds !== undefined
        || binding.releaseSeconds !== undefined;
    case "combine": return combine !== undefined;
    case "order": return binding.params?.order !== undefined;
  }
}

const PARAMETER_KEYS: ParameterKey[] = ["range", "envelope", "combine", "order"];

/**
 * How the colour-theme playlist plays, as three mutually exclusive icons.
 *
 * A real radio group rather than three toggles: exactly one is always on, and
 * `role="radiogroup"` plus `aria-checked` is what tells a screen reader that
 * choosing one clears the others. Icons because the three modes are the same
 * three every media transport has, and their glyphs are more legible at a
 * glance than the words were in the dropdown this replaced.
 */
const PLAYBACK_ORDERS: {
  value: PhonoscopePlaybackOrder;
  label: string;
  detail: string;
  icon: typeof Repeat;
}[] = [
  { value: "once", label: "Play once", detail: "Run through the playlist and hold on the last theme.", icon: ArrowRight },
  { value: "loop", label: "Loop", detail: "Run through the playlist and start again.", icon: Repeat },
  { value: "shuffle", label: "Shuffle", detail: "Pick a different theme at random each time.", icon: Shuffle },
];

function PlaybackOrderControl({
  onChange,
  value,
}: {
  onChange: (order: PhonoscopePlaybackOrder) => void;
  value: PhonoscopePlaybackOrder;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-black uppercase text-neutral-400">Playback</span>
      <div role="radiogroup" aria-label="Playback" className="flex items-center gap-2">
        {PLAYBACK_ORDERS.map((order) => {
          const Icon = order.icon;
          const active = value === order.value;
          return (
            <MomentaryFeedbackButton
              key={order.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={order.label}
              title={`${order.label} — ${order.detail}`}
              className={`flex items-center gap-2 rounded border px-3 py-2 text-xs ${
                active
                  ? "border-cyan-400 text-cyan-200"
                  : "border-neutral-800 text-neutral-500"
              }`}
              onClick={() => onChange(order.value)}
            >
              <Icon className="h-4 w-4" />
              <span>{order.label}</span>
            </MomentaryFeedbackButton>
          );
        })}
      </div>
    </div>
  );
}

function pictureDeclaration(id: string) {
  return PHONOSCOPE_PICTURE_EFFECTS.find((effect) => effect.id === id);
}

/**
 * The centre transition as one control set rather than four effects.
 *
 * The mode decides what the rest of the set even means, so the set follows the
 * mode: a cross-fade shows nothing but its ramp, a flip adds the axis it
 * collapses along, and a slide adds the divisions and which edge the pieces
 * come back from. An axis slider sitting under a cross-fade would be a control
 * that does nothing, and the user would have had to know that.
 *
 * The ramp is always shown because every transition has one — it is the
 * transition's own motion, not a parameter of one of its modes. On a one-shot
 * transition the three phases read as attack = ease-in, hold = flat, release =
 * ease-out, and the transition lasts exactly their sum.
 *
 * Underneath, each row is still its own effect id with its own binding, so the
 * override resolution, both engines and the conformance corpus are untouched:
 * this is entirely how it is presented and written.
 */
function CentreTransitionControl({
  binding,
  companionValue,
  envelope,
  onChange,
  onCompanionChange,
}: {
  binding: PhonoscopeEffectBinding;
  companionValue: (effect: string) => number;
  envelope: [number, number, number];
  onChange: (binding: PhonoscopeEffectBinding) => void;
  onCompanionChange: (effect: string, value: number) => void;
}) {
  const mode = Math.round(binding.min ?? binding.max ?? 0);
  return (
    <div className="grid gap-3">
      <ConfigSelect
        label="Transition"
        value={String(mode)}
        options={CENTRE_TRANSITION_CHOICES.map((choice) => ({
          value: String(choice.value),
          label: choice.label,
        }))}
        onChange={(value) =>
          onChange({ ...binding, min: Number(value), max: Number(value) })}
      />

      {CENTRE_TRANSITION_COMPANIONS.filter((companion) => mode >= companion.minimumMode)
        .map((companion) => {
          const declaration = pictureDeclaration(companion.id);
          if (!declaration) return null;
          const labels = PHONOSCOPE_PICTURE_EFFECT_LABELS[companion.id];
          const label = labels?.shortLabel ?? labels?.label ?? companion.id;
          const value = companionValue(companion.id);
          if (companion.id === PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT) {
            return (
              <CheckboxRow
                key={companion.id}
                checked={value >= 0.5}
                detail={labels?.description}
                label={label}
                onChange={(checked) => onCompanionChange(companion.id, checked ? 1 : 0)}
              />
            );
          }
          const degrees = companion.id === PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT;
          return (
            <SliderControlPanel
              key={companion.id}
              ariaLabel={label}
              ariaValueText={String(Math.round(value))}
              color={[34, 211, 238]}
              label={label}
              min={declaration.min}
              max={declaration.max}
              step={declaration.step}
              value={value}
              valueText={`${Math.round(value)}${degrees ? "°" : ""}`}
              onPreview={(next) => onCompanionChange(companion.id, next)}
              onCommit={(next) => onCompanionChange(companion.id, next)}
            />
          );
        })}

      <EnvelopeSliderControlPanel
        ariaLabel="Transition ramp"
        label="Ramp"
        value={envelope}
        onPreview={([attackSeconds, holdSeconds, releaseSeconds]) =>
          onChange({ ...binding, attackSeconds, holdSeconds, releaseSeconds })}
        onCommit={([attackSeconds, holdSeconds, releaseSeconds]) =>
          onChange({ ...binding, attackSeconds, holdSeconds, releaseSeconds })}
      />
      <p className="text-xs text-neutral-500">
        Attack eases the transition in, hold runs it at a steady speed, release eases it out. The
        transition lasts all three end to end.
      </p>
    </div>
  );
}

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
 * One appearance of an effect inside a lane.
 *
 * Collapsed it is just the name. Expanded it shows only the parameters that
 * have been added — everything else inherits the effect's declared default, so
 * a binding stores what the user actually chose and nothing more.
 */
export function EffectEntry({
  binding,
  combine,
  companions,
  driver,
  effect,
  onChange,
  onCombineChange,
  onCombineRemove,
  onCompanionChange,
  onDuplicate,
  onPaste,
  onRemove,
}: {
  binding: PhonoscopeEffectBinding;
  /** Shared by every appearance of this effect, so it is edited via the group. */
  combine: PhonoscopeCombineMode | undefined;
  /** Bindings elsewhere in the lane that this effect's control set owns. */
  companions?: PhonoscopeEffectBinding[];
  driver: PhonoscopeDriver;
  effect: EffectOption;
  onChange: (binding: PhonoscopeEffectBinding) => void;
  /** Set one of those companion values, creating its binding if there is none. */
  onCompanionChange?: (effect: string, value: number) => void;
  onCombineChange: (mode: PhonoscopeCombineMode) => void;
  onCombineRemove: () => void;
  onDuplicate: () => void;
  onPaste: (binding: PhonoscopeEffectBinding) => void;
  onRemove: () => void;
}) {
  const range: [number, number] = [
    binding.min ?? effect.min,
    binding.max ?? effect.max,
  ];
  const envelope: [number, number, number] = [
    binding.attackSeconds ?? 0.05,
    binding.holdSeconds ?? 0,
    binding.releaseSeconds ?? 0.6,
  ];
  // The rotation pulses are instructions: any non-zero contribution advances
  // the rotation by one entry, or flips the alt state, so the range is fixed at
  // 0-1 and there is nothing to author. The envelope is still the cross-fade,
  // which is why it is labelled "Transition" on both of them.
  const themePulse = isPhonoscopeThemePulseEffect(binding.effect);
  const fixedRange = themePulse;
  // An override-only axis has nothing to decide: it never stacks, so offering
  // "When stacked" would be offering a choice that is not taken.
  const overrideOnly = isPhonoscopeOverrideOnlyEffect(binding.effect);
  // The transition brings its own control set, which IS its parameters: there
  // is nothing left for the sparse "+ Add parameter" menu to offer.
  const controlSet = binding.effect === PHONOSCOPE_CENTRE_TRANSITION_EFFECT;
  const companionValue = (effectId: string) => {
    const declaration = pictureDeclaration(effectId);
    let resolved = declaration?.default ?? 0;
    for (const entry of companions ?? []) {
      if (entry.effect !== effectId) continue;
      const value = entry.min ?? entry.max;
      if (typeof value === "number" && Number.isFinite(value)) resolved = value;
    }
    return resolved;
  };
  const missing = controlSet ? [] : PARAMETER_KEYS.filter((key) => {
    if (key === "order" && binding.effect !== PHONOSCOPE_THEME_CHANGE_EFFECT) return false;
    if (key === "range" && fixedRange) return false;
    if (key === "combine" && overrideOnly) return false;
    // A discrete axis cuts between modes, it never ramps, so an envelope on it
    // would only describe a shape it cannot take. A pinned axis is one value
    // held for a whole transition, which is the same story.
    if (key === "envelope" && (effect.choices || effect.toggle || effect.pinned)) return false;
    return !hasParameter(binding, combine, key);
  });

  const removeParameter = (key: ParameterKey) => {
    if (key === "combine") {
      onCombineRemove();
      return;
    }
    const next = { ...binding };
    if (key === "range") {
      delete next.min;
      delete next.max;
      // The RND tag belongs to the range, not to itself: with no range to draw
      // from there is nothing for it to mean.
      delete next.randomValue;
    } else if (key === "envelope") {
      delete next.attackSeconds;
      delete next.holdSeconds;
      delete next.releaseSeconds;
    } else {
      const params = { ...(next.params ?? {}) };
      delete params.order;
      // An empty params object would persist as a parameter that is not set.
      if (Object.keys(params).length) next.params = params;
      else delete next.params;
    }
    onChange(next);
  };

  const addParameter = (key: ParameterKey) => {
    if (key === "combine") {
      onCombineChange("add");
      return;
    }
    if (key === "range") {
      // A discrete or pinned axis starts as a fixed choice — both ends on the
      // default — so adding it picks a value rather than sweeping the axis.
      if (effect.choices || effect.toggle || effect.pinned) {
        onChange({ ...binding, min: effect.default, max: effect.default });
        return;
      }
      onChange({ ...binding, min: effect.min, max: effect.max });
      return;
    }
    if (key === "envelope") {
      onChange({ ...binding, attackSeconds: 0.05, holdSeconds: 0, releaseSeconds: 0.6 });
      return;
    }
    onChange({ ...binding, params: { ...(binding.params ?? {}), order: 0 } });
  };

  return (
    <ConfigAccordion
      id={`effect-${binding.id}`}
      // Inside a group the heading already carries the subject, so the member
      // reads as "Opacity" rather than "Glow opacity". Only grouped effects
      // define a short label, so this is the full one everywhere else.
      title={effect.shortLabel ?? effect.label}
      className="border border-neutral-800 bg-neutral-950/45"
      actions={
        <span className="flex items-center gap-2">
          <CopyActions
            kind="binding"
            label={effect.label}
            payload={binding}
            onDuplicate={onDuplicate}
          />
          <MomentaryFeedbackButton
            type="button"
            className="icon-link text-red-200"
            aria-label={`Remove ${effect.label}`}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </MomentaryFeedbackButton>
        </span>
      }
    >
      <div className="grid gap-3 p-3 text-sm">
        {effect.description ? (
          <p className="text-xs text-neutral-500">{effect.description}</p>
        ) : null}
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

        {overrideOnly ? (
          <p className="text-xs text-neutral-500">
            Always overrides: where more than one settings group sets this, the last one in the
            entry&rsquo;s list wins outright. It never stacks.
          </p>
        ) : null}

        {controlSet ? (
          <CentreTransitionControl
            binding={binding}
            companionValue={companionValue}
            envelope={envelope}
            onChange={onChange}
            onCompanionChange={(effectId, value) => onCompanionChange?.(effectId, value)}
          />
        ) : null}

        {!overrideOnly && hasParameter(binding, combine, "combine") ? (
          <ParameterRow label="When stacked" onRemove={() => removeParameter("combine")}>
            <ConfigSelect
              label="When stacked"
              value={combine ?? "add"}
              options={[
                { value: "add", label: "Sum", detail: "Every lane's contribution adds together." },
                {
                  value: "strongest",
                  label: "Least frequent lane wins",
                  detail: "The rarest lane that is firing takes it outright.",
                },
                {
                  value: "common",
                  label: "Most frequent lane wins",
                  detail: "The busiest lane that is firing takes it outright.",
                },
                {
                  value: "override",
                  label: "Override",
                  detail: "The last settings group to set it replaces the value entirely.",
                },
              ]}
              onChange={(mode) => onCombineChange(mode as PhonoscopeCombineMode)}
            />
          </ParameterRow>
        ) : null}

        {binding.effect === PHONOSCOPE_THEME_CHANGE_EFFECT
          && hasParameter(binding, combine, "order") ? (
          <ParameterRow label="Playback" onRemove={() => removeParameter("order")}>
            <PlaybackOrderControl
              value={phonoscopePlaybackOrder(binding.params?.order)}
              onChange={(order) => onChange({
                ...binding,
                params: {
                  ...(binding.params ?? {}),
                  order: PHONOSCOPE_PLAYBACK_ORDER_VALUES[order],
                },
              })}
            />
          </ParameterRow>
        ) : null}

        {hasParameter(binding, combine, "range") && effect.toggle ? (
          // A 0/1 axis reads as on or off. Both ends are pinned together, so it
          // is a state rather than something a driver sweeps.
          <ParameterRow label={effect.label} onRemove={() => removeParameter("range")}>
            <CheckboxRow
              checked={range[0] >= 0.5}
              detail={effect.description}
              label={effect.label}
              onChange={(checked) => onChange({
                ...binding,
                min: checked ? 1 : 0,
                max: checked ? 1 : 0,
              })}
            />
          </ParameterRow>
        ) : null}

        {hasParameter(binding, combine, "range") && effect.choices && !fixedRange
          && !controlSet ? (
          // A discrete axis is one choice, not a sweep: the way to change a
          // blend mode with the music is a second lane carrying its own glow,
          // so both ends of the range are pinned to the selected mode.
          <ParameterRow label={effect.label} onRemove={() => removeParameter("range")}>
            <ConfigSelect
              label={effect.label}
              value={String(range[0])}
              options={effect.choices.map((choice) => ({
                value: String(choice.value),
                label: choice.label,
              }))}
              onChange={(value) =>
                onChange({ ...binding, min: Number(value), max: Number(value) })}
            />
          </ParameterRow>
        ) : null}

        {hasParameter(binding, combine, "range") && effect.pinned && !fixedRange ? (
          // Continuous, but one value rather than a sweep: the transition
          // latches it when it starts and holds it for the whole run, so both
          // ends of the range sit on the chosen number.
          <ParameterRow label={effect.label} onRemove={() => removeParameter("range")}>
            <SliderControlPanel
              ariaLabel={effect.label}
              ariaValueText={String(Math.round(range[0]))}
              color={[34, 211, 238]}
              label={effect.label}
              min={effect.min}
              max={effect.max}
              step={effect.step}
              value={range[0]}
              valueText={String(Math.round(range[0]))}
              onPreview={(value) => onChange({ ...binding, min: value, max: value })}
              onCommit={(value) => onChange({ ...binding, min: value, max: value })}
            />
          </ParameterRow>
        ) : null}

        {hasParameter(binding, combine, "range") && !effect.choices && !effect.toggle
          && !effect.pinned && !fixedRange ? (
          <ParameterRow label="Range" onRemove={() => removeParameter("range")}>
            <RangeSliderControlPanel
              ariaLabel={`${effect.label} range`}
              label="Minimum / Maximum"
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
            />
          </ParameterRow>
        ) : null}

        {hasParameter(binding, combine, "envelope") && !effect.choices && !effect.pinned ? (
          <ParameterRow
            label={themePulse ? "Transition" : "Envelope"}
            onRemove={() => removeParameter("envelope")}
          >
            <EnvelopeSliderControlPanel
              ariaLabel={`${effect.label} envelope`}
              label={themePulse ? "Transition" : "Envelope"}
              value={envelope}
              onPreview={([attackSeconds, holdSeconds, releaseSeconds]) =>
                onChange({ ...binding, attackSeconds, holdSeconds, releaseSeconds })}
              onCommit={([attackSeconds, holdSeconds, releaseSeconds]) =>
                onChange({ ...binding, attackSeconds, holdSeconds, releaseSeconds })}
            />
          </ParameterRow>
        ) : null}

        <PasteIntoButton
          kind="binding"
          what={effect.label}
          // Only another appearance of the same effect: a range and envelope
          // authored for one setting mean nothing on a different one.
          accepts={(pasted) => pasted.effect === binding.effect}
          onPaste={onPaste}
        />

        {missing.length ? (
          <ConfigSelect
            label="Add parameter"
            value=""
            options={[
              { value: "", label: "Add parameter…" },
              ...missing.map((key) => ({
                value: key,
                label: key === "range"
                  ? (effect.choices || effect.toggle || effect.pinned ? effect.label : "Range")
                  : key === "envelope"
                    ? (themePulse ? "Transition" : "Envelope")
                    : key === "combine" ? "When stacked" : "Playback",
              })),
            ]}
            onChange={(key) => { if (key) addParameter(key as ParameterKey); }}
          />
        ) : null}
      </div>
    </ConfigAccordion>
  );
}

/**
 * The "+ Add effect" control at the bottom of a lane.
 *
 * Grouped effects are offered as their group — one "Glow" entry rather than
 * five — and picking one adds its first member. Everything the groups do not
 * claim is listed as before.
 */
export function AddEffectControl({
  catalogue,
  groups,
  onAdd,
  onAddGroup,
}: {
  catalogue: EffectOption[];
  groups: ResolvedEffectGroup[];
  onAdd: (effectId: string) => void;
  onAddGroup: (group: ResolvedEffectGroup) => void;
}) {
  const grouped = effectGroupIndex(groups);
  // A companion is not something you add: the control set that owns it decides
  // when it exists, so offering it here would be offering a second way in.
  const ungrouped = catalogue.filter((effect) => !grouped.has(effect.id) && !effect.companion);
  const sections = [...new Set(ungrouped.map((effect) => effect.section))];
  return (
    <ConfigSelect
      label="Add effect"
      value=""
      options={[
        { value: "", label: "Add effect…" },
        ...groups.map((group) => ({
          value: `group:${group.id}`,
          label: group.label,
          detail: group.section,
        })),
        ...sections.flatMap((section) => ungrouped
          .filter((effect) => effect.section === section)
          .map((effect) => ({
            value: effect.id,
            label: effect.label,
            detail: section,
          }))),
      ]}
      onChange={(value) => {
        if (!value) return;
        const group = groups.find((entry) => `group:${entry.id}` === value);
        if (group) onAddGroup(group);
        else onAdd(value);
      }}
    />
  );
}

export function addEffectIcon() {
  return <Plus className="h-4 w-4" />;
}
