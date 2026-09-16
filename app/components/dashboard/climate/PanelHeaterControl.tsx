"use client";

import { Clock, Power, PowerOff, X } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import type { DashboardEntity, PanelHeaterPreferences } from "../../../../lib/types";
import {
  airconOffTimerIncrementMs,
  AIRCON_OFF_TIMER_INCREMENT_MINUTES_DEFAULT,
  normalizeAirconOffTimerIncrementMinutes,
} from "../../../../lib/aircon-config";
import { isClimateEntityOn } from "../../../../lib/aircon-control";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { ControlCard } from "../ControlCard";
import { loadSharedClientConfig, readCachedClientConfig } from "../../sharedConfigCache";
import { classNames } from "../shared";
import { callClimateActions, savePanelHeaterTimer } from "./client";
import { TemperatureStepper } from "./TemperatureStepper";
import type { EntityActionsHandler } from "./types";

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

export function PanelHeaterControl({
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
    return <ControlCard subPanel cardId="panel-heater" kicker="Heating Unit" title="Panel Heater" />;
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
    <ControlCard subPanel cardId="panel-heater" entity={entity} kicker="Heating Unit" title="Panel Heater">
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
