"use client";

import {
  Fan,
  Flame,
  Gauge,
  Minus,
  Plus,
  Power,
  PowerOff,
  Snowflake,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import type { AirconPreferences, DashboardEntity, DashboardPreferences } from "../../../lib/types";
import {
  AIRCON_FAN_STEPS,
  airconAutoMeasuredTemperature,
  airconAutoSupported,
  airconEntityMode,
  airconFanModeServiceValue,
  airconFanStep,
  airconFanStepActions,
  airconModeSupported,
  buildAirconAutoActions,
  climateCurrentTemperature,
  climateTargetTemperature,
  isAirconMode,
  isClimateEntityOn,
  stringListAttribute,
  type AirconFanStep,
  type AirconMode,
  type EntityActionInput,
} from "../../../lib/aircon-control";
import { DotLineControl } from "../DotControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import {
  classNames,
  climateDevicesForZone,
  formatTemperature,
  temperatureDelta,
  type LoungeEnvironment,
} from "./shared";
import type { DashboardZone } from "../../../lib/types";

type EntityActionsHandler = (actions: EntityActionInput[], toast: string) => Promise<void>;

function callClimateActions(actions: EntityActionInput[], onEntityActions: EntityActionsHandler, toast: string) {
  return onEntityActions(actions, toast);
}

function ClimateCard({
  children,
  entity,
  kicker,
  title,
}: {
  children?: ReactNode;
  entity?: DashboardEntity;
  kicker: string;
  title: string;
}) {
  const unavailable = entity ? ["unknown", "unavailable"].includes(entity.state) : true;

  return (
    <section className="climate-card border border-neutral-700 bg-neutral-950/70 p-5">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-black uppercase text-cyan-300">{kicker}</p>
          <h2 className="mt-1 truncate text-3xl font-black uppercase text-neutral-50">{title}</h2>
        </div>
        <div
          className={classNames(
            "border px-3 py-2 text-xs font-black uppercase",
            unavailable ? "border-red-400/50 text-red-400" : "border-cyan-300/50 text-cyan-200",
          )}
        >
          {entity?.state ?? "missing"}
        </div>
      </header>

      {entity ? children : <p className="text-sm font-black uppercase text-neutral-400">Entity missing</p>}
    </section>
  );
}

function TemperatureStepper({
  currentTemperature,
  disabled = false,
  entity,
  label,
  onChange,
  onTargetPreviewChange,
  step = 0.5,
  targetTemperature,
}: {
  currentTemperature?: number | null;
  disabled?: boolean;
  entity: DashboardEntity;
  label: string;
  onChange: (temperature: number) => Promise<void>;
  onTargetPreviewChange?: (temperature: number) => void;
  step?: number;
  targetTemperature?: number | null;
}) {
  const serverTarget = climateTargetTemperature(entity);
  const displayedTarget = targetTemperature ?? serverTarget;
  const current = currentTemperature ?? climateCurrentTemperature(entity);
  const [target, setTarget] = useState(displayedTarget);

  useEffect(() => {
    setTarget(displayedTarget);
  }, [displayedTarget, entity.entity_id]);

  const nudge = (delta: number) => {
    if (disabled) {
      return;
    }

    const next = temperatureDelta(entity, delta, step, target ?? displayedTarget ?? current ?? 20);
    setTarget(next);
    onTargetPreviewChange?.(next);
    void onChange(next);
  };

  return (
    <div className={classNames("temperature-stepper border border-neutral-700 bg-neutral-950/70 p-4", disabled && "temperature-stepper-disabled")}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase text-cyan-300">{label}</p>
          <p className="climate-temp-readout mt-1 font-black tabular-nums text-neutral-50">
            {formatTemperature(target)}
            <span>&deg;</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-black uppercase text-neutral-400">Current</p>
          <p className="font-mono text-xl font-black tabular-nums text-neutral-100">
            {formatTemperature(current)}
            <span>&deg;</span>
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <MomentaryFeedbackButton
          type="button"
          className="climate-icon-button border"
          aria-label={`Lower ${label}`}
          disabled={disabled}
          onClick={() => nudge(-step)}
        >
          <Minus className="h-7 w-7" />
        </MomentaryFeedbackButton>
        <MomentaryFeedbackButton
          type="button"
          className="climate-icon-button border"
          aria-label={`Raise ${label}`}
          disabled={disabled}
          onClick={() => nudge(step)}
        >
          <Plus className="h-7 w-7" />
        </MomentaryFeedbackButton>
      </div>
    </div>
  );
}

export function LabeledSwitch({
  checked,
  disabled,
  icon,
  label,
  leftLabel,
  onChange,
  rightLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  leftLabel: string;
  onChange: () => void;
  rightLabel: string;
}) {
  return (
    <div className={classNames("climate-switch-row border", disabled && "climate-switch-row-disabled")}>
      <span className="climate-switch-label">{leftLabel}</span>
      <MomentaryFeedbackButton
        type="button"
        className={classNames("cyber-switch", checked && "cyber-switch-checked")}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
      >
        <span className="cyber-switch-thumb">{icon}</span>
      </MomentaryFeedbackButton>
      <span className="climate-switch-label">{rightLabel}</span>
    </div>
  );
}

function PanelHeaterControl({
  entity,
  onEntityActions,
}: {
  entity?: DashboardEntity;
  onEntityActions: EntityActionsHandler;
}) {
  if (!entity) {
    return <ClimateCard kicker="Heating Unit" title="Panel Heater" />;
  }

  const isOn = isClimateEntityOn(entity);

  const setTemperature = (temperature: number) =>
    callClimateActions(
      [{ entityId: entity.entity_id, domain: "climate", service: "set_temperature", data: { temperature } }],
      onEntityActions,
      `Panel Heater ${temperature} degrees`,
    );

  const setPower = () =>
    callClimateActions(
      [
        isOn
          ? { entityId: entity.entity_id, domain: "climate", service: "turn_off" }
          : { entityId: entity.entity_id, domain: "climate", service: "turn_on" },
      ],
      onEntityActions,
      `Panel Heater ${isOn ? "off" : "on"}`,
    );

  return (
    <ClimateCard entity={entity} kicker="Heating Unit" title="Panel Heater">
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <MomentaryFeedbackButton
            type="button"
            className={classNames("climate-toggle border", isOn && "climate-toggle-active")}
            role="switch"
            aria-checked={isOn}
            onClick={setPower}
          >
            <Power className="h-6 w-6" />
            <span>{isOn ? "On" : "Off"}</span>
          </MomentaryFeedbackButton>
          <LabeledSwitch
            checked={false}
            disabled
            label="Panel heater single or double panel mode unavailable"
            leftLabel="I Slow"
            rightLabel="II Fast"
            onChange={() => undefined}
          />
        </div>

        <TemperatureStepper disabled={!isOn} entity={entity} label="Temperature" step={1} onChange={setTemperature} />
      </div>
    </ClimateCard>
  );
}

const AIRCON_MODE_BUTTONS: ReadonlyArray<{
  label: string;
  mode: AirconMode;
  Icon: ComponentType<{ className?: string }>;
}> = [
  { label: "Heating", mode: "heat", Icon: Flame },
  { label: "Cooling", mode: "cool", Icon: Snowflake },
  { label: "Fan", mode: "fan_only", Icon: Fan },
] as const;

const AIRCON_POWER_BUTTONS: ReadonlyArray<{
  label: string;
  state: "auto" | "manual" | "off";
  Icon: ComponentType<{ className?: string }>;
}> = [
  { label: "Auto", state: "auto", Icon: Gauge },
  { label: "Manual", state: "manual", Icon: Power },
  { label: "Off", state: "off", Icon: PowerOff },
] as const;

function autoPreferenceFallbackAction(entity: DashboardEntity, settings: AirconPreferences): EntityActionInput {
  const temperature = typeof settings.temperature === "number" ? settings.temperature : climateTargetTemperature(entity);
  const mode = isAirconMode(settings.hvacMode) && settings.hvacMode !== "auto"
    ? settings.hvacMode
    : airconEntityMode(entity);

  return {
    entityId: entity.entity_id,
    domain: "climate",
    service: "set_temperature",
    data: typeof temperature === "number" ? { temperature } : undefined,
    remember: {
      aircon: {
        autoMode: true,
        hvacMode: mode,
        temperature: typeof temperature === "number" ? temperature : undefined,
      },
    },
  };
}

function AirConditionerControl({
  entity,
  freshAirSwitch,
  loungeEnvironment,
  preferences,
  quietSwitch,
  turboSwitch,
  onEntityActions,
}: {
  entity?: DashboardEntity;
  freshAirSwitch?: DashboardEntity;
  loungeEnvironment?: LoungeEnvironment | null;
  preferences?: AirconPreferences;
  quietSwitch?: DashboardEntity;
  turboSwitch?: DashboardEntity;
  onEntityActions: EntityActionsHandler;
}) {
  const currentFanIndex = entity ? AIRCON_FAN_STEPS.indexOf(airconFanStep(entity, quietSwitch, turboSwitch)) : 0;
  const [displayedFanStep, setDisplayedFanStep] = useState<AirconFanStep>(
    AIRCON_FAN_STEPS[currentFanIndex] ?? "medium",
  );
  const entityTargetTemperature = entity ? climateTargetTemperature(entity) ?? undefined : undefined;
  const rememberedTargetTemperature = typeof preferences?.temperature === "number" ? preferences.temperature : undefined;
  const preferredTargetTemperature =
    preferences?.autoMode === true
      ? rememberedTargetTemperature ?? entityTargetTemperature
      : entityTargetTemperature ?? rememberedTargetTemperature;
  const [selectedTargetTemperature, setSelectedTargetTemperature] = useState<number | undefined>(preferredTargetTemperature);

  useEffect(() => {
    setDisplayedFanStep(AIRCON_FAN_STEPS[currentFanIndex] ?? "medium");
  }, [currentFanIndex]);

  useEffect(() => {
    setSelectedTargetTemperature(preferredTargetTemperature);
  }, [entity?.entity_id, preferredTargetTemperature]);

  if (!entity) {
    return <ClimateCard kicker="Air Control" title="Air Conditioner" />;
  }

  const isOn = isClimateEntityOn(entity);
  const supportedModes = stringListAttribute(entity, "hvac_modes");
  const entityUnavailable = ["unavailable", "unknown"].includes(entity.state);

  const airconSettings = {
    autoMode: preferences?.autoMode ?? false,
    hvacMode:
      preferences?.hvacMode ??
      (isOn && entity.state !== "off" && entity.state !== "unavailable" && entity.state !== "unknown" ? entity.state : undefined),
    temperature: selectedTargetTemperature ?? preferredTargetTemperature,
    fanMode: preferences?.fanMode ?? String(entity.attributes.fan_mode ?? "medium"),
    quietMode: preferences?.quietMode ?? quietSwitch?.state === "on",
    turboMode: preferences?.turboMode ?? turboSwitch?.state === "on",
  } satisfies AirconPreferences;
  const isControlOn = isOn || airconSettings.autoMode;
  const activePowerState = airconSettings.autoMode ? "auto" : isOn ? "manual" : "off";
  const activeMode = isOn
    ? airconEntityMode(entity) ??
      (isAirconMode(airconSettings.hvacMode) && airconSettings.hvacMode !== "auto" ? airconSettings.hvacMode : undefined)
    : undefined;

  const setOff = () => {
    return callClimateActions(
      [
        {
          entityId: entity.entity_id,
          domain: "climate",
          service: "turn_off",
          remember: { aircon: { autoMode: false } },
        },
      ],
      onEntityActions,
      "Air Conditioner off",
    );
  };

  const setOn = () => {
    const actions: EntityActionInput[] = [];
    const preferredMode = isAirconMode(airconSettings.hvacMode) ? airconSettings.hvacMode : undefined;
    const hvacMode =
      preferredMode && airconModeSupported(supportedModes, preferredMode)
        ? preferredMode
        : supportedModes.find((mode) => !["off", "unavailable", "unknown"].includes(mode));

    actions.push({ entityId: entity.entity_id, domain: "climate", service: "turn_on" });

    if (hvacMode) {
      actions.push({
        entityId: entity.entity_id,
        domain: "climate",
        service: "set_hvac_mode",
        data: { hvac_mode: hvacMode },
        remember: { aircon: { autoMode: false, hvacMode } },
      });
    }

    if (typeof airconSettings.temperature === "number") {
      actions.push({
        entityId: entity.entity_id,
        domain: "climate",
        service: "set_temperature",
        data: { temperature: airconSettings.temperature },
        remember: { aircon: { autoMode: false, temperature: airconSettings.temperature } },
      });
    }

    if (quietSwitch) {
      actions.push({
        entityId: quietSwitch.entity_id,
        domain: "switch",
        service: airconSettings.quietMode ? "turn_on" : "turn_off",
        remember: { aircon: { quietMode: airconSettings.quietMode } },
      });
    }

    if (turboSwitch) {
      actions.push({
        entityId: turboSwitch.entity_id,
        domain: "switch",
        service: airconSettings.turboMode ? "turn_on" : "turn_off",
        remember: { aircon: { turboMode: airconSettings.turboMode } },
      });
    }

    actions.push({
      entityId: entity.entity_id,
      domain: "climate",
      service: "set_fan_mode",
      data: { fan_mode: airconSettings.fanMode },
      remember: { aircon: { fanMode: airconSettings.fanMode } },
    });

    return callClimateActions(actions, onEntityActions, "Air Conditioner manual");
  };

  const setMode = (mode: AirconMode, label: string) => {
    if (mode === "auto") {
      const actions = buildAirconAutoActions({
        currentTemperature: airconAutoMeasuredTemperature(entity, loungeEnvironment),
        entity,
        forceRemember: true,
        preferences: airconSettings,
        quietSwitch,
        turboSwitch,
      });

      return callClimateActions(
        actions.length ? actions : [autoPreferenceFallbackAction(entity, airconSettings)],
        onEntityActions,
        "Air Conditioner Auto",
      );
    }

    return callClimateActions(
      [
        {
          entityId: entity.entity_id,
          domain: "climate",
          service: "set_hvac_mode",
          data: { hvac_mode: mode },
          remember: { aircon: { autoMode: false, hvacMode: mode } },
        },
      ],
      onEntityActions,
      `Air Conditioner ${label}`,
    );
  };

  const setTemperature = (temperature: number) => {
    setSelectedTargetTemperature(temperature);
    return callClimateActions(
      [
        {
          entityId: entity.entity_id,
          domain: "climate",
          service: "set_temperature",
          data: { temperature },
          remember: { aircon: { temperature } },
        },
      ],
      onEntityActions,
      `Air Conditioner ${temperature} degrees`,
    );
  };

  const setFreshAir = () =>
    freshAirSwitch
      ? callClimateActions(
        [
          {
            entityId: freshAirSwitch.entity_id,
            domain: "switch",
            service: freshAirSwitch.state === "on" ? "turn_off" : "turn_on",
          },
        ],
        onEntityActions,
        `Air Conditioner fresh air ${freshAirSwitch.state === "on" ? "off" : "on"}`,
      )
      : Promise.resolve();

  const setFanStep = (step: AirconFanStep) => {
    const fanMode = airconFanModeServiceValue(step);

    return callClimateActions(
      airconFanStepActions({
        entity,
        quietSwitch,
        remember: {
          autoMode: false,
          fanMode,
          quietMode: step === "quiet",
          turboMode: step === "turbo",
        },
        step,
        turboSwitch,
      }),
      onEntityActions,
      `Air Conditioner fan ${step}`,
    );
  };

  const choosePowerState = (state: "auto" | "manual" | "off") => {
    if (state === "auto") {
      return setMode("auto", "Auto");
    }
    if (state === "manual") {
      return setOn();
    }
    return setOff();
  };

  return (
    <ClimateCard entity={entity} kicker="Air Control" title="Air Conditioner">
      <div className="grid gap-4">
        <div className="aircon-state-grid grid grid-cols-3 gap-2">
          {AIRCON_POWER_BUTTONS.map(({ Icon, label, state }) => {
            const active = activePowerState === state;
            const disabled = entityUnavailable || (state === "auto" && !airconAutoSupported(supportedModes));
            return (
              <button
                key={state}
                type="button"
                aria-pressed={active}
                className={classNames("aircon-state-button border", active && "aircon-state-button-active")}
                disabled={disabled}
                onClick={() => choosePowerState(state)}
              >
                <Icon className="h-6 w-6" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <div className="climate-mode-grid grid grid-cols-3 gap-3">
          {AIRCON_MODE_BUTTONS.map(({ Icon, label, mode }) => {
            const active = activeMode === mode;
            const unavailable = !airconModeSupported(supportedModes, mode);
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={active}
                className={classNames("climate-mode-button border", active && "climate-mode-button-active")}
                disabled={entityUnavailable || unavailable}
                onClick={() => setMode(mode, label)}
              >
                <Icon className="h-6 w-6" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3">
            <LabeledSwitch
              checked={freshAirSwitch?.state === "on"}
              disabled={!isControlOn || !freshAirSwitch}
              label="Air conditioner fresh air"
              leftLabel="Recirculate"
              rightLabel="Fresh"
              onChange={setFreshAir}
            />
          </div>
        </div>

        <TemperatureStepper
          currentTemperature={loungeEnvironment?.temperature}
          disabled={!isControlOn}
          entity={entity}
          label="Temperature"
          onTargetPreviewChange={setSelectedTargetTemperature}
          step={1}
          targetTemperature={airconSettings.temperature}
          onChange={setTemperature}
        />

        <div className={classNames("climate-fan-speed border border-neutral-700 bg-neutral-950/70 p-4", !isControlOn && "climate-fan-speed-disabled")}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-black uppercase text-cyan-300">Fan Speed</p>
            <p className="font-mono text-sm font-black uppercase text-neutral-100">{displayedFanStep}</p>
          </div>
          <DotLineControl
            ariaLabel="Air conditioner fan speed"
            ariaValueText={displayedFanStep}
            disabled={!isControlOn}
            min={0}
            max={AIRCON_FAN_STEPS.length - 1}
            step={1}
            value={currentFanIndex}
            onChange={(index) => {
              setDisplayedFanStep(AIRCON_FAN_STEPS[Math.round(index)] ?? "medium");
            }}
            onCommit={(index) => {
              const step = AIRCON_FAN_STEPS[Math.round(index)] ?? "medium";
              setDisplayedFanStep(step);
              void setFanStep(step);
            }}
            markers={[
              { active: displayedFanStep === "quiet", label: "Quiet", value: 0 },
              { active: displayedFanStep === "turbo", label: "Turbo", value: AIRCON_FAN_STEPS.length - 1 },
            ]}
          />
        </div>
      </div>
    </ClimateCard>
  );
}

export function ClimateControls({
  loungeEnvironment,
  onEntityActions,
  preferences,
  zone,
}: {
  loungeEnvironment?: LoungeEnvironment | null;
  onEntityActions: EntityActionsHandler;
  preferences?: DashboardPreferences;
  zone: DashboardZone;
}) {
  const { aircon, freshAirSwitch, heater, quietSwitch, turboSwitch } = climateDevicesForZone(zone);

  return (
    <div className="climate-control-grid grid gap-5">
      <AirConditionerControl
        entity={aircon}
        freshAirSwitch={freshAirSwitch}
        loungeEnvironment={loungeEnvironment}
        preferences={preferences?.aircon}
        quietSwitch={quietSwitch}
        turboSwitch={turboSwitch}
        onEntityActions={onEntityActions}
      />
      <PanelHeaterControl entity={heater} onEntityActions={onEntityActions} />
    </div>
  );
}
