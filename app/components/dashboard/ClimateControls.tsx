"use client";

import {
  Clock,
  Fan,
  Flame,
  Gauge,
  Minus,
  Plus,
  Power,
  PowerOff,
  Snowflake,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { AirconPreferences, DashboardEntity, DashboardPreferences, PanelHeaterPreferences } from "../../../lib/types";
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
import {
  AIRCON_OFF_TIMER_INCREMENT_MINUTES_DEFAULT,
  airconOffTimerIncrementMs,
  normalizeAirconOffTimerIncrementMinutes,
} from "../../../lib/aircon-config";
import { DotLineControl } from "../DotControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { loadSharedClientConfig, readCachedClientConfig } from "../sharedConfigCache";
import {
  classNames,
  climateDevicesForZone,
  formatTemperature,
  temperatureDelta,
  type LoungeEnvironment,
} from "./shared";
import type { DashboardZone } from "../../../lib/types";

type EntityActionsHandler = (
  actions: EntityActionInput[],
  toast: string,
  options?: { silent?: boolean },
) => Promise<void>;

// How long after the last temperature tap we wait before sending the final
// set_temperature to the air conditioner. Only the last value is ever sent.
const AIRCON_TEMPERATURE_SEND_DEBOUNCE_MS = 2000;

// The control sound is a UX press acknowledgement, so any command that fires
// later than the gesture (debounce timers, off-timer expiry) must pass
// silent:true and let the press itself play the sound.
function callClimateActions(
  actions: EntityActionInput[],
  onEntityActions: EntityActionsHandler,
  toast: string,
  options?: { silent?: boolean },
) {
  return onEntityActions(actions, toast, options);
}

function offTimerIncrementFromClientConfig(payload: unknown) {
  const config = payload as {
    dashboard?: { aircon?: { offTimerIncrementMinutes?: unknown } };
  } | null;
  return normalizeAirconOffTimerIncrementMinutes(config?.dashboard?.aircon?.offTimerIncrementMinutes);
}

function readCachedOffTimerIncrementMinutes() {
  return offTimerIncrementFromClientConfig(readCachedClientConfig());
}

async function fetchOffTimerIncrementMinutes() {
  return offTimerIncrementFromClientConfig(await loadSharedClientConfig());
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
          <p className="temp-readout climate-current-readout font-mono font-black tabular-nums text-neutral-100">
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
  preferences,
}: {
  entity?: DashboardEntity;
  onEntityActions: EntityActionsHandler;
  preferences?: PanelHeaterPreferences;
}) {
  const persistedTimerEndsAt = typeof preferences?.offTimerEndsAt === "string" ? preferences.offTimerEndsAt : null;
  const [localTimerEndsAt, setLocalTimerEndsAt] = useState<string | null>(persistedTimerEndsAt);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [timerIncrementMinutes, setTimerIncrementMinutes] = useState(AIRCON_OFF_TIMER_INCREMENT_MINUTES_DEFAULT);
  const timerExpiryInFlight = useRef(false);
  const offTimerEndsAtMs = timerEndMs(localTimerEndsAt);
  const offTimerActive = offTimerEndsAtMs !== null && offTimerEndsAtMs > timerNow;
  const offTimerRemainingMs = offTimerEndsAtMs !== null ? Math.max(0, offTimerEndsAtMs - timerNow) : 0;
  const timerIncrementMs = airconOffTimerIncrementMs(timerIncrementMinutes);

  useEffect(() => {
    let alive = true;

    const loadTimerIncrement = async () => {
      const cachedIncrement = readCachedOffTimerIncrementMinutes();
      if (alive) {
        setTimerIncrementMinutes(cachedIncrement);
      }

      try {
        if (alive) {
          setTimerIncrementMinutes(await fetchOffTimerIncrementMinutes());
        }
      } catch {
        // Keep the shipped default when config cannot be read.
      }
    };

    void loadTimerIncrement();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setLocalTimerEndsAt(persistedTimerEndsAt);
  }, [persistedTimerEndsAt]);

  useEffect(() => {
    if (offTimerEndsAtMs === null) {
      return;
    }

    setTimerNow(Date.now());
    const timer = window.setInterval(() => {
      setTimerNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [offTimerEndsAtMs]);

  useEffect(() => {
    if (!entity || offTimerEndsAtMs === null || offTimerEndsAtMs > timerNow || timerExpiryInFlight.current) {
      return;
    }

    timerExpiryInFlight.current = true;
    setLocalTimerEndsAt(null);
    void callClimateActions(
      [
        {
          entityId: entity.entity_id,
          domain: "climate",
          service: "turn_off",
          remember: { panelHeater: { offTimerEndsAt: null } },
        },
      ],
      onEntityActions,
      "Panel Heater timer expired",
      { silent: true },
    ).finally(() => {
      timerExpiryInFlight.current = false;
    });
  }, [entity, offTimerEndsAtMs, onEntityActions, timerNow]);

  if (!entity) {
    return <ClimateCard kicker="Heating Unit" title="Panel Heater" />;
  }

  const isOn = isClimateEntityOn(entity);
  const entityUnavailable = ["unavailable", "unknown"].includes(entity.state);
  const activePowerState = isOn ? "on" : "off";

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
          ? {
              entityId: entity.entity_id,
              domain: "climate",
              service: "turn_off",
              remember: { panelHeater: { offTimerEndsAt: null } },
            }
          : { entityId: entity.entity_id, domain: "climate", service: "turn_on" },
      ],
      onEntityActions,
      `Panel Heater ${isOn ? "off" : "on"}`,
    );

  const choosePowerState = (state: "on" | "off") => {
    if ((state === "on" && isOn) || (state === "off" && !isOn)) {
      return Promise.resolve();
    }
    return setPower();
  };

  const setOffTimer = (offTimerEndsAt: string | null) => {
    setLocalTimerEndsAt(offTimerEndsAt);
    void savePanelHeaterTimer(offTimerEndsAt).catch(() => {
      setLocalTimerEndsAt(persistedTimerEndsAt);
    });
  };

  const addOffTimer = () => {
    const now = Date.now();
    const base = offTimerEndsAtMs !== null && offTimerEndsAtMs > now ? offTimerEndsAtMs : now;
    setOffTimer(new Date(base + timerIncrementMs).toISOString());
  };

  const clearOffTimer = () => {
    setOffTimer(null);
  };

  return (
    <ClimateCard entity={entity} kicker="Heating Unit" title="Panel Heater">
      <div className="grid gap-4">
        <TemperatureStepper disabled={!isOn} entity={entity} label="Temperature" step={1} onChange={setTemperature} />

        <div className="panel-heater-state-grid grid grid-cols-2 gap-2">
          {PANEL_HEATER_POWER_BUTTONS.map(({ Icon, label, state }) => {
            const active = activePowerState === state;

            return (
              <button
                key={state}
                type="button"
                aria-pressed={active}
                className={classNames("aircon-state-button border", active && "aircon-state-button-active")}
                disabled={entityUnavailable}
                onClick={() => choosePowerState(state)}
              >
                <Icon className="h-6 w-6" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <div className={classNames("climate-timer-row", !isOn && "climate-timer-row-disabled")}>
          <MomentaryFeedbackButton
            type="button"
            aria-label={offTimerActive ? `Add ${timerIncrementMinutes} minutes to panel heater off timer` : `Start ${timerIncrementMinutes} minute panel heater off timer`}
            className={classNames("climate-timer-button border", offTimerActive && "climate-timer-button-active")}
            disabled={entityUnavailable || !isOn}
            onClick={addOffTimer}
          >
            <Clock className="h-6 w-6" />
            <span>{offTimerActive ? formatTimerRemaining(offTimerRemainingMs) : `${timerIncrementMinutes} min`}</span>
          </MomentaryFeedbackButton>
          {offTimerActive ? (
            <MomentaryFeedbackButton
              type="button"
              aria-label="Clear panel heater off timer"
              className="climate-timer-cancel border"
              disabled={entityUnavailable}
              onClick={clearOffTimer}
            >
              <X className="h-6 w-6" />
            </MomentaryFeedbackButton>
          ) : null}
        </div>
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
  { label: "Fan", mode: "fan_only", Icon: Fan },
  { label: "Cooling", mode: "cool", Icon: Snowflake },
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

const PANEL_HEATER_POWER_BUTTONS: ReadonlyArray<{
  label: string;
  state: "on" | "off";
  Icon: ComponentType<{ className?: string }>;
}> = [
  { label: "On", state: "on", Icon: Power },
  { label: "Off", state: "off", Icon: PowerOff },
] as const;

function timerEndMs(value?: string | null) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatTimerRemaining(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const paddedSeconds = seconds.toString().padStart(2, "0");
  const paddedMinutes = minutes.toString().padStart(hours > 0 ? 2 : 1, "0");

  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${paddedMinutes}:${paddedSeconds}`;
}

async function saveClimateTimer(path: string, offTimerEndsAt: string | null, fallbackMessage: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offTimerEndsAt }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? fallbackMessage);
  }
}

async function saveAirconTimer(offTimerEndsAt: string | null) {
  await saveClimateTimer("/api/aircon/timer", offTimerEndsAt, "Failed to update aircon timer");
}

async function savePanelHeaterTimer(offTimerEndsAt: string | null) {
  await saveClimateTimer("/api/panel-heater/timer", offTimerEndsAt, "Failed to update panel heater timer");
}

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
  // The dashboard's target temperature is whatever the user last selected
  // (remembered server-side). We deliberately do NOT read the air conditioner's
  // live target back into the dashboard — Home Assistant's reported setpoint is
  // only used to seed an initial value the very first time, before anything has
  // been remembered.
  const entityTargetTemperature = entity ? climateTargetTemperature(entity) ?? undefined : undefined;
  const rememberedTargetTemperature = typeof preferences?.temperature === "number" ? preferences.temperature : undefined;
  const preferredTargetTemperature = rememberedTargetTemperature ?? entityTargetTemperature;
  const [selectedTargetTemperature, setSelectedTargetTemperature] = useState<number | undefined>(preferredTargetTemperature);
  const temperatureSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTemperatureRef = useRef<number | null>(null);
  const persistedTimerEndsAt = typeof preferences?.offTimerEndsAt === "string" ? preferences.offTimerEndsAt : null;
  const [localTimerEndsAt, setLocalTimerEndsAt] = useState<string | null>(persistedTimerEndsAt);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [timerIncrementMinutes, setTimerIncrementMinutes] = useState(AIRCON_OFF_TIMER_INCREMENT_MINUTES_DEFAULT);
  const timerExpiryInFlight = useRef(false);
  const offTimerEndsAtMs = timerEndMs(localTimerEndsAt);
  const offTimerActive = offTimerEndsAtMs !== null && offTimerEndsAtMs > timerNow;
  const offTimerRemainingMs = offTimerEndsAtMs !== null ? Math.max(0, offTimerEndsAtMs - timerNow) : 0;
  const timerIncrementMs = airconOffTimerIncrementMs(timerIncrementMinutes);

  useEffect(() => {
    setDisplayedFanStep(AIRCON_FAN_STEPS[currentFanIndex] ?? "medium");
  }, [currentFanIndex]);

  useEffect(() => {
    setSelectedTargetTemperature(preferredTargetTemperature);
  }, [entity?.entity_id, preferredTargetTemperature]);

  useEffect(() => {
    return () => {
      if (temperatureSendTimerRef.current) {
        clearTimeout(temperatureSendTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let alive = true;

    const loadTimerIncrement = async () => {
      const cachedIncrement = readCachedOffTimerIncrementMinutes();
      if (alive) {
        setTimerIncrementMinutes(cachedIncrement);
      }

      try {
        if (alive) {
          setTimerIncrementMinutes(await fetchOffTimerIncrementMinutes());
        }
      } catch {
        // Keep the shipped default when config cannot be read.
      }
    };

    void loadTimerIncrement();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setLocalTimerEndsAt(persistedTimerEndsAt);
  }, [persistedTimerEndsAt]);

  useEffect(() => {
    if (offTimerEndsAtMs === null) {
      return;
    }

    setTimerNow(Date.now());
    const timer = window.setInterval(() => {
      setTimerNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [offTimerEndsAtMs]);

  useEffect(() => {
    if (!entity || offTimerEndsAtMs === null || offTimerEndsAtMs > timerNow || timerExpiryInFlight.current) {
      return;
    }

    timerExpiryInFlight.current = true;
    setLocalTimerEndsAt(null);
    void callClimateActions(
      [
        {
          entityId: entity.entity_id,
          domain: "climate",
          service: "turn_off",
          remember: { aircon: { autoMode: false, offTimerEndsAt: null } },
        },
      ],
      onEntityActions,
      "Air Conditioner timer expired",
      { silent: true },
    ).finally(() => {
      timerExpiryInFlight.current = false;
    });
  }, [entity, offTimerEndsAtMs, onEntityActions, timerNow]);

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
  // Auto wins on display: the user's selected power state must stick. Auto now
  // switches the unit OFF at homeostasis, so the unit being off does NOT mean the
  // user pressed Off — while autoMode is remembered the control stays on "Auto"
  // (the unit just resting). Only with autoMode cleared does on/off follow the
  // unit, and that only changes by a deliberate user press because the auto loop
  // stands down the moment autoMode is cleared.
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
          remember: { aircon: { autoMode: false, offTimerEndsAt: null } },
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

  const sendTemperature = (temperature: number) =>
    callClimateActions(
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
      { silent: true },
    );

  // Changing the target updates the dashboard immediately but debounces the
  // actual command: 2s after the last tap a single set_temperature with the final
  // value is sent. In Auto the thermostat loop picks the new target up on its next
  // tick (the unit stays on, parked on fan), so there is no special wake handling.
  // Global interaction feedback plays on the tap; the debounced send is silent.
  const setTemperature = (temperature: number) => {
    setSelectedTargetTemperature(temperature);
    pendingTemperatureRef.current = temperature;
    if (temperatureSendTimerRef.current) {
      clearTimeout(temperatureSendTimerRef.current);
    }
    temperatureSendTimerRef.current = setTimeout(() => {
      temperatureSendTimerRef.current = null;
      const value = pendingTemperatureRef.current;
      pendingTemperatureRef.current = null;
      if (value !== null) {
        void sendTemperature(value);
      }
    }, AIRCON_TEMPERATURE_SEND_DEBOUNCE_MS);
    return Promise.resolve();
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

  const setOffTimer = (offTimerEndsAt: string | null) => {
    setLocalTimerEndsAt(offTimerEndsAt);
    void saveAirconTimer(offTimerEndsAt).catch(() => {
      setLocalTimerEndsAt(persistedTimerEndsAt);
    });
  };

  const addOffTimer = () => {
    const now = Date.now();
    const base = offTimerEndsAtMs !== null && offTimerEndsAtMs > now ? offTimerEndsAtMs : now;
    setOffTimer(new Date(base + timerIncrementMs).toISOString());
  };

  const clearOffTimer = () => {
    setOffTimer(null);
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
        <TemperatureStepper
          disabled={!isControlOn}
          entity={entity}
          label="Temperature"
          onTargetPreviewChange={setSelectedTargetTemperature}
          step={1}
          targetTemperature={airconSettings.temperature}
          onChange={setTemperature}
        />

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

        <div className={classNames("climate-timer-row", !isControlOn && "climate-timer-row-disabled")}>
          <MomentaryFeedbackButton
            type="button"
            aria-label={offTimerActive ? `Add ${timerIncrementMinutes} minutes to air conditioner off timer` : `Start ${timerIncrementMinutes} minute air conditioner off timer`}
            className={classNames("climate-timer-button border", offTimerActive && "climate-timer-button-active")}
            disabled={entityUnavailable || !isControlOn}
            onClick={addOffTimer}
          >
            <Clock className="h-6 w-6" />
            <span>{offTimerActive ? formatTimerRemaining(offTimerRemainingMs) : `${timerIncrementMinutes} min`}</span>
          </MomentaryFeedbackButton>
          {offTimerActive ? (
            <MomentaryFeedbackButton
              type="button"
              aria-label="Clear air conditioner off timer"
              className="climate-timer-cancel border"
              disabled={entityUnavailable}
              onClick={clearOffTimer}
            >
              <X className="h-6 w-6" />
            </MomentaryFeedbackButton>
          ) : null}
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
      <PanelHeaterControl entity={heater} preferences={preferences?.panelHeater} onEntityActions={onEntityActions} />
    </div>
  );
}
