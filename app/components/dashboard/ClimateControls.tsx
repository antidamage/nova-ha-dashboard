"use client";

import {
  Clock,
  Minus,
  Plus,
  Power,
  PowerOff,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import type {
  AirconPreferences,
  BedroomHeaterPreferences,
  DashboardEntity,
  DashboardPreferences,
  ClimateControlRoomState,
  PanelHeaterPreferences,
} from "../../../lib/types";
import {
  airconOffTimerIncrementMs,
  AIRCON_OFF_TIMER_INCREMENT_MINUTES_DEFAULT,
  normalizeAirconOffTimerIncrementMinutes,
} from "../../../lib/aircon-config";
import {
  climateCurrentTemperature,
  climateTargetTemperature,
  isClimateEntityOn,
} from "../../../lib/aircon-control";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { ControlCard } from "./ControlCard";
import { ModuleSlot } from "../modules/ModuleSlot";
import { loadSharedClientConfig, readCachedClientConfig } from "../sharedConfigCache";
import { AirconKnob, HeaterKnob } from "./ClimateKnobs";
import { callClimateActions, climateCardTitles, type EntityActionsHandler } from "./climateCommands";
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

/**
 * The +/− target stepper. The air conditioner and the bedroom heater moved to
 * the temperature knob on 2026-09-12 (specs/temperature-encoder.md); this is
 * still how the legacy panel-heater card sets its target.
 */
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

// The switch that used to live here is `LabeledSlideSwitch` in
// `app/components/SlideSwitch.tsx` — the surface's only toggle now
// (specs/slide-switch.md).

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

/**
 * The bedroom heater: one knob and nothing else (Adeline, 2026-09-12).
 *
 * Its target, its Auto/Off lights and its sleep timer are all on the dial now,
 * so the card carries no stepper, no button grid, no timer row and no humidity
 * line. See specs/temperature-encoder.md.
 */
function BedroomHeaterControl({
  humidity,
  onNotice,
  preferences,
  preferredRange,
  switchEntity,
  temperature,
  title,
}: {
  controlState?: ClimateControlRoomState;
  humidity: number | null;
  onNotice?: (message: string) => void;
  preferences?: BedroomHeaterPreferences;
  preferredRange?: { min: number; max: number };
  switchEntity?: DashboardEntity;
  temperature: number | null;
  /** Usually the room, from dashboard.bedroomHeater.title in config. */
  title: string;
}) {
  if (!switchEntity) {
    return <ControlCard cardId="bedroom-heater" kicker="Heating Unit" title={title} />;
  }

  // No card header: the knob's title arc names the room (Adeline, 2026-09-12,
  // specs/temperature-encoder.md). The card above, with no entity to show, keeps
  // its header — there is no knob there to carry the name.
  return (
    <ControlCard cardId="bedroom-heater" entity={switchEntity}>
      <div className="climate-knob-body">
        <HeaterKnob
          humidity={humidity}
          preferences={preferences}
          preferredRange={preferredRange}
          switchEntity={switchEntity}
          temperature={temperature}
          title={title}
          onNotice={onNotice}
        />
      </div>
      <ModuleSlot id="thermostat.heater.controls" context={{ entity: switchEntity, preferences }} />
    </ControlCard>
  );
}

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

async function savePanelHeaterTimer(offTimerEndsAt: string | null) {
  const response = await fetch("/api/panel-heater/timer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offTimerEndsAt }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Failed to update panel heater timer");
  }
}

/**
 * The air conditioner: one knob and nothing else (Adeline, 2026-09-12).
 *
 * Mode, fan speed, fresh air and the off timer are its rings, and the power
 * state is its lights. See specs/temperature-encoder.md.
 */
function AirConditionerControl({
  controlState,
  entity,
  freshAirSwitch,
  preferences,
  preferredRange,
  quietSwitch,
  title,
  turboSwitch,
  onEntityActions,
}: {
  controlState?: ClimateControlRoomState;
  entity?: DashboardEntity;
  freshAirSwitch?: DashboardEntity;
  preferences?: AirconPreferences;
  preferredRange?: { min: number; max: number };
  quietSwitch?: DashboardEntity;
  /** Usually the room, from dashboard.aircon.title in config. */
  title: string;
  turboSwitch?: DashboardEntity;
  onEntityActions: EntityActionsHandler;
}) {
  if (!entity) {
    return <ControlCard cardId="aircon" kicker="Air Control" title={title} />;
  }

  // No card header — see BedroomHeaterControl above.
  return (
    <ControlCard cardId="aircon" entity={entity}>
      <div className="climate-knob-body">
        <AirconKnob
          climateControl={controlState}
          entity={entity}
          freshAirSwitch={freshAirSwitch}
          preferences={preferences}
          preferredRange={preferredRange}
          quietSwitch={quietSwitch}
          title={title}
          turboSwitch={turboSwitch}
          onEntityActions={onEntityActions}
        />
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
          preferredRange={preferences?.climateTargetRange}
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
          preferredRange={preferences?.climateTargetRange}
          switchEntity={bedroomHeater?.switchEntity}
          temperature={bedroomHeater?.temperature ?? null}
          title={titles.heater}
          onNotice={onNotice}
        />
      ) : null}
      {showLegacyPanelHeater ? (
        <PanelHeaterControl entity={heater} preferences={preferences?.panelHeater} onEntityActions={onEntityActions} />
      ) : null}
    </div>
  );
}
