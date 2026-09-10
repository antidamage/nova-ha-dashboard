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
import type {
  AirconPreferences,
  BedroomHeaterMode,
  BedroomHeaterPreferences,
  DashboardEntity,
  DashboardPreferences,
  ClimateControlRoomState,
  PanelHeaterPreferences,
} from "../../../lib/types";
import {
  BEDROOM_HEATER_MAX_TARGET_C,
  BEDROOM_HEATER_MIN_TARGET_C,
} from "../../../lib/bedroom-heater-control";
import {
  AIRCON_FAN_STEPS,
  airconAutoMeasuredTemperature,
  airconAutoSupported,
  airconFanModeServiceValue,
  airconFanStep,
  airconFanStepActions,
  airconModeSupported,
  climateCurrentTemperature,
  climateTargetTemperature,
  isClimateEntityOn,
  type AirconFanStep,
  type AirconMode,
} from "../../../lib/aircon-control";
import {
  AIRCON_OFF_TIMER_INCREMENT_MINUTES_DEFAULT,
  airconOffTimerIncrementMs,
  normalizeAirconOffTimerIncrementMinutes,
} from "../../../lib/aircon-config";
import { DotLineControl } from "../DotControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { ControlCard } from "./ControlCard";
import { ModuleSlot } from "../modules/ModuleSlot";
import { loadSharedClientConfig, readCachedClientConfig } from "../sharedConfigCache";
import { callClimateActions, climateCardTitles, type EntityActionsHandler } from "./climateCommands";
import { useSharedAirconCommands, useSharedBedroomHeaterCommands } from "./ClimateCommandsProvider";
import {
  classNames,
  climateDevicesForZone,
  formatTemperature,
  temperatureDelta,
  type BedroomHeaterDevices,
} from "./shared";
import type { DashboardZone } from "../../../lib/types";

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

function TemperatureStepper({
  currentTemperature,
  disabled = false,
  entity,
  label,
  maxTemperature,
  minTemperature,
  onChange,
  onTargetPreviewChange,
  step = 0.5,
  targetTemperature,
}: {
  currentTemperature?: number | null;
  disabled?: boolean;
  entity: DashboardEntity;
  label: string;
  /**
   * Bounds for callers whose limit is a Nova concept rather than a climate
   * entity attribute — a bare switch has no min_temp/max_temp to read, and
   * without these the readout would climb past a limit the caller then clamps.
   */
  maxTemperature?: number;
  minTemperature?: number;
  onChange: (temperature: number) => Promise<void>;
  onTargetPreviewChange?: (temperature: number) => void;
  step?: number;
  targetTemperature?: number | null;
}) {
  const serverTarget = climateTargetTemperature(entity);
  const displayedTarget = targetTemperature ?? serverTarget;
  const current = currentTemperature === undefined ? climateCurrentTemperature(entity) : currentTemperature;
  const [target, setTarget] = useState(displayedTarget);

  useEffect(() => {
    setTarget(displayedTarget);
  }, [displayedTarget, entity.entity_id]);

  const nudge = (delta: number) => {
    if (disabled) {
      return;
    }

    const stepped = temperatureDelta(entity, delta, step, target ?? displayedTarget ?? current ?? 20);
    const next = Math.min(maxTemperature ?? Infinity, Math.max(minTemperature ?? -Infinity, stepped));
    if (next === target) {
      return;
    }
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
            {target === null ? null : <span>&deg;</span>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-black uppercase text-neutral-400">Current</p>
          <p className="temp-readout climate-current-readout font-mono font-black tabular-nums text-neutral-100">
            {formatTemperature(current)}
            {current === null ? null : <span>&deg;</span>}
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
    return <ControlCard cardId="panel-heater" kicker="Heating Unit" title="Panel Heater" />;
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
    <ControlCard cardId="panel-heater" entity={entity} kicker="Heating Unit" title="Panel Heater">
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
    </ControlCard>
  );
}

// Two states, not three. "Manual" used to sit between these and meant "hold the
// switch on", which is what Auto already does to a cold room — it was a third
// button for a state the user could not distinguish.
const BEDROOM_HEATER_POWER_BUTTONS: ReadonlyArray<{
  label: string;
  state: BedroomHeaterMode;
  Icon: ComponentType<{ className?: string }>;
}> = [
  { label: "Auto", state: "auto", Icon: Gauge },
  { label: "Off", state: "off", Icon: PowerOff },
] as const;

function BedroomHeaterControl({
  controlState,
  humidity,
  onEntityActions,
  onNotice,
  preferences,
  switchEntity,
  temperature,
  title,
}: {
  controlState?: ClimateControlRoomState;
  humidity: number | null;
  onEntityActions: EntityActionsHandler;
  onNotice?: (message: string) => void;
  preferences?: BedroomHeaterPreferences;
  switchEntity?: DashboardEntity;
  temperature: number | null;
  /** Usually the room, from dashboard.bedroomHeater.title in config. */
  title: string;
}) {
  // Mode, target and timer writes live in useBedroomHeaterCommands so the
  // Quick Access segment shares them (specs/quick-access-card.md).
  const { changeTarget, chooseMode, displayedTarget, localTimerEndsAt, mode, setOffTimer } =
    useSharedBedroomHeaterCommands({ onNotice, preferences });

  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [timerIncrementMinutes, setTimerIncrementMinutes] = useState(AIRCON_OFF_TIMER_INCREMENT_MINUTES_DEFAULT);
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

  if (!switchEntity) {
    return <ControlCard cardId="bedroom-heater" kicker="Heating Unit" title={title} />;
  }

  const entityUnavailable = ["unavailable", "unknown"].includes(switchEntity.state);
  const isOn = switchEntity.state === "on";

  const addOffTimer = () => {
    const now = Date.now();
    const base = offTimerEndsAtMs !== null && offTimerEndsAtMs > now ? offTimerEndsAtMs : now;
    setOffTimer(new Date(base + timerIncrementMs).toISOString());
  };

  const clearOffTimer = () => {
    setOffTimer(null);
  };

  return (
    <ControlCard cardId="bedroom-heater" entity={switchEntity} kicker="Heating Unit" title={title}>
      <div className="grid gap-4">
        {/*
          Off is the only mode with no target to set: it means auto off and the
          heater off. Under Auto the heater's own switch may well be idle, but
          the target still governs when it fires again, so the stepper stays live.
        */}
        <TemperatureStepper
          currentTemperature={temperature}
          disabled={entityUnavailable || mode === "off"}
          entity={switchEntity}
          label="Temperature"
          maxTemperature={BEDROOM_HEATER_MAX_TARGET_C}
          minTemperature={BEDROOM_HEATER_MIN_TARGET_C}
          step={1}
          targetTemperature={displayedTarget}
          onChange={changeTarget}
        />

        <div className="aircon-state-grid grid grid-cols-2 gap-2">
          {BEDROOM_HEATER_POWER_BUTTONS.map(({ Icon, label, state }) => {
            // Server truth only. A pending tap shows in the banner above, not as
            // a confirmed selection — the card must never assert a mode the
            // server has not acknowledged.
            const active = mode === state;

            return (
              <button
                key={state}
                type="button"
                aria-pressed={active}
                className={classNames("aircon-state-button border", active && "aircon-state-button-active")}
                disabled={entityUnavailable}
                onClick={() => chooseMode(state)}
              >
                <Icon className="h-6 w-6" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <div className={classNames("climate-timer-row", mode === "off" && "climate-timer-row-disabled")}>
          <MomentaryFeedbackButton
            type="button"
            aria-label={
              offTimerActive
                ? `Add ${timerIncrementMinutes} minutes to bedroom heater sleep timer`
                : `Start ${timerIncrementMinutes} minute bedroom heater sleep timer`
            }
            className={classNames("climate-timer-button border", offTimerActive && "climate-timer-button-active")}
            disabled={entityUnavailable || mode === "off"}
            onClick={addOffTimer}
          >
            <Clock className="h-6 w-6" />
            <span>{offTimerActive ? formatTimerRemaining(offTimerRemainingMs) : `${timerIncrementMinutes} min`}</span>
          </MomentaryFeedbackButton>
          {offTimerActive ? (
            <MomentaryFeedbackButton
              type="button"
              aria-label="Clear bedroom heater sleep timer"
              className="climate-timer-cancel border"
              disabled={entityUnavailable}
              onClick={clearOffTimer}
            >
              <X className="h-6 w-6" />
            </MomentaryFeedbackButton>
          ) : null}
        </div>

        {/*
          The heater has no schedule: it runs only when the user puts it in Auto,
          and stops on the target, on Off, or on a sleep timer they set. Nothing
          here may turn it on or off by the clock alone.
        */}
        <div className="temperature-stepper border border-neutral-700 bg-neutral-950/70 px-4 py-3">
          <p className="text-xs font-black uppercase text-neutral-400">
            Humidity {humidity === null ? "--" : `${Math.round(humidity)}%`} &middot;{" "}
            {isOn ? "Heating" : "Idle"}
          </p>
        </div>
      </div>
      <ModuleSlot id="thermostat.heater.controls" context={{ entity: switchEntity, preferences }} />
    </ControlCard>
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

function AirConditionerControl({
  controlState,
  entity,
  freshAirSwitch,
  preferences,
  quietSwitch,
  title,
  turboSwitch,
  onEntityActions,
}: {
  controlState?: ClimateControlRoomState;
  entity?: DashboardEntity;
  freshAirSwitch?: DashboardEntity;
  preferences?: AirconPreferences;
  quietSwitch?: DashboardEntity;
  /** Usually the room, from dashboard.aircon.title in config. */
  title: string;
  turboSwitch?: DashboardEntity;
  onEntityActions: EntityActionsHandler;
}) {
  const currentFanIndex = entity ? AIRCON_FAN_STEPS.indexOf(airconFanStep(entity, quietSwitch, turboSwitch)) : 0;
  const [displayedFanStep, setDisplayedFanStep] = useState<AirconFanStep>(
    AIRCON_FAN_STEPS[currentFanIndex] ?? "medium",
  );
  // Power, mode and setpoint commands live in useAirconCommands so the Quick
  // Access segment shares them (specs/quick-access-card.md).
  const {
    activeMode,
    activePowerState,
    airconSettings,
    choosePowerState,
    commandControl,
    entityUnavailable,
    isControlOn,
    setMode,
    setSelectedTargetTemperature,
    setTemperature,
    supportedModes,
  } = useSharedAirconCommands({ controlState, entity, preferences, quietSwitch, turboSwitch, onEntityActions });
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
    return <ControlCard cardId="aircon" kicker="Air Control" title={title} />;
  }

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
    const actions = airconFanStepActions({
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
    });

    // Choosing a fan speed by hand carries autoMode: false, so it leaves Auto —
    // but only when it actually sends something, since the remember rides on the
    // last action and a no-op change sends none.
    if (actions.length) {
      commandControl({ power: "manual" });
    }

    return callClimateActions(actions, onEntityActions, `Air Conditioner fan ${step}`);
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

  return (
    <ControlCard cardId="aircon" entity={entity} kicker="Air Control" title={title}>
      <div className="grid gap-4">
        <TemperatureStepper
          currentTemperature={airconAutoMeasuredTemperature(entity)}
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
            const disabled =
              entityUnavailable ||
              (state === "auto" && !airconAutoSupported(supportedModes));
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
      <ModuleSlot id="thermostat.aircon.controls" context={{ entity, preferences }} />
    </ControlCard>
  );
}

function legacyPanelHeaterEnabled(payload: unknown) {
  const config = payload as { dashboard?: { legacyPanelHeaterCardEnabled?: unknown } } | null;
  return config?.dashboard?.legacyPanelHeaterCardEnabled === true;
}

export function ClimateControls({
  bedroomHeater,
  climateControl,
  onEntityActions,
  onNotice,
  preferences,
  zone,
}: {
  bedroomHeater?: BedroomHeaterDevices;
  climateControl?: import("../../../lib/types").ClimateControlState;
  onEntityActions: EntityActionsHandler;
  onNotice?: (message: string) => void;
  preferences?: DashboardPreferences;
  zone: DashboardZone;
}) {
  const { aircon, freshAirSwitch, heater, quietSwitch, turboSwitch } = climateDevicesForZone(zone);
  // The original panel heater died in August 2026; its card stays in the tree
  // but is off unless an equivalent unit is reinstated in config.
  const [showLegacyPanelHeater, setShowLegacyPanelHeater] = useState(() =>
    legacyPanelHeaterEnabled(readCachedClientConfig()),
  );
  const [titles, setTitles] = useState(() => climateCardTitles(readCachedClientConfig()));

  useEffect(() => {
    let alive = true;

    void loadSharedClientConfig()
      .then((payload) => {
        if (alive) {
          setShowLegacyPanelHeater(legacyPanelHeaterEnabled(payload));
          setTitles(climateCardTitles(payload));
        }
      })
      .catch(() => {
        // Keep the cached answer when config cannot be read.
      });

    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="climate-control-grid grid gap-5">
      {/*
        Each card renders only when this home actually has the device. A home
        with no air conditioner used to get an empty card headed "Lounge", and
        one with no heater an empty "Bedroom" — a room it may not have, holding
        controls that do nothing.
      */}
      {aircon ? (
        <AirConditionerControl
          controlState={climateControl?.lounge}
          entity={aircon}
          freshAirSwitch={freshAirSwitch}
          preferences={preferences?.aircon}
          quietSwitch={quietSwitch}
          title={titles.aircon}
          turboSwitch={turboSwitch}
          onEntityActions={onEntityActions}
        />
      ) : null}
      {bedroomHeater?.switchEntity ? (
        <BedroomHeaterControl
          controlState={climateControl?.bedroom}
          humidity={bedroomHeater?.humidity ?? null}
          preferences={preferences?.bedroomHeater}
          switchEntity={bedroomHeater?.switchEntity}
          temperature={bedroomHeater?.temperature ?? null}
          title={titles.heater}
          onEntityActions={onEntityActions}
          onNotice={onNotice}
        />
      ) : null}
      {showLegacyPanelHeater ? (
        <PanelHeaterControl entity={heater} preferences={preferences?.panelHeater} onEntityActions={onEntityActions} />
      ) : null}
    </div>
  );
}
