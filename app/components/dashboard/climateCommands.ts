"use client";

/**
 * Climate command logic shared by the full climate cards (`ClimateControls`)
 * and the compact Quick Access segments (`QuickAccessCard`).
 *
 * These hooks are the only place the aircon's power-intent hold, Auto arming
 * and debounced setpoint, and the bedroom heater's server-truth save handling
 * live. A second surface calling them gets identical behaviour; copying them
 * would let the two drift. See specs/quick-access-card.md,
 * specs/aircon-auto-control.md and specs/bedroom-heater-control-integrity.md.
 */
import { useEffect, useRef, useState } from "react";
import type {
  AirconPreferences,
  BedroomHeaterMode,
  BedroomHeaterPreferences,
  ClimateControlMode,
  ClimateControlRoomState,
  DashboardEntity,
} from "../../../lib/types";
import {
  BEDROOM_HEATER_MAX_TARGET_C,
  BEDROOM_HEATER_MIN_TARGET_C,
  bedroomHeaterMode,
  bedroomHeaterTargetTemperature,
} from "../../../lib/bedroom-heater-control";
import {
  airconAutoCycleStateFromPreferences,
  airconAutoMeasuredTemperature,
  airconEntityMode,
  airconModeSupported,
  buildAirconAutoActions,
  climateTargetTemperature,
  isAirconMode,
  isClimateEntityOn,
  stringListAttribute,
  type AirconMode,
  type EntityActionInput,
} from "../../../lib/aircon-control";
import { resolveCommandedState, type CommandedState } from "../../../lib/climate-control-policy";
import { loadSharedClientConfig, readCachedClientConfig } from "../sharedConfigCache";
import { formatTemperature } from "./shared";

export type EntityActionsHandler = (
  actions: EntityActionInput[],
  toast: string,
  options?: { silent?: boolean },
) => Promise<void>;

// How long after the last temperature tap we wait before sending the final
// set_temperature to the air conditioner. Only the last value is ever sent.
export const AIRCON_TEMPERATURE_SEND_DEBOUNCE_MS = 2000;

// The control sound is a UX press acknowledgement, so any command that fires
// later than the gesture (debounce timers, off-timer expiry) must pass
// silent:true and let the press itself play the sound.
export function callClimateActions(
  actions: EntityActionInput[],
  onEntityActions: EntityActionsHandler,
  toast: string,
  options?: { silent?: boolean },
) {
  return onEntityActions(actions, toast, options);
}

/**
 * What each climate card calls itself. Usually the room it sits in, which is a
 * fact about one floor plan — the components used to say "Lounge" and "Bedroom"
 * outright, so every install inherited this house's rooms.
 */
export function climateCardTitles(payload: unknown) {
  const dashboard = (payload as { dashboard?: { aircon?: { title?: unknown }; bedroomHeater?: { title?: unknown } } } | null)
    ?.dashboard;
  const text = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim() ? value.trim() : fallback;
  return {
    aircon: text(dashboard?.aircon?.title, "Climate"),
    heater: text(dashboard?.bedroomHeater?.title, "Heater"),
  };
}

/** The climate card titles from config, cached first and refreshed once. */
export function useClimateCardTitles() {
  const [titles, setTitles] = useState(() => climateCardTitles(readCachedClientConfig()));

  useEffect(() => {
    let alive = true;
    void loadSharedClientConfig()
      .then((payload) => {
        if (alive) setTitles(climateCardTitles(payload));
      })
      .catch(() => {
        // Keep the cached answer when config cannot be read.
      });
    return () => {
      alive = false;
    };
  }, []);

  return titles;
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

/**
 * The air conditioner's power, mode and setpoint commands.
 *
 * Call unconditionally; with no entity every command resolves without sending.
 */
export function useAirconCommands({
  controlState,
  entity,
  preferences,
  quietSwitch,
  turboSwitch,
  onEntityActions,
}: {
  controlState?: ClimateControlRoomState;
  entity?: DashboardEntity;
  preferences?: AirconPreferences;
  quietSwitch?: DashboardEntity;
  turboSwitch?: DashboardEntity;
  onEntityActions: EntityActionsHandler;
}) {
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

  // A press must light its own button immediately. The controller's view of the
  // room lags a press by a poll or more — it only reports "off" once the Gree
  // itself says so — and until then it still reads "auto", which would leave the
  // control claiming the very state the user just cancelled. So the pressed
  // selection is held over the controller's until the controller agrees, someone
  // works the unit itself, or the command is plainly not coming.
  const [powerIntent, setPowerIntent] = useState<CommandedState<ClimateControlMode> | null>(null);
  const [modeIntent, setModeIntent] = useState<CommandedState<AirconMode> | null>(null);
  const [intentNow, setIntentNow] = useState(() => Date.now());

  const controlOwner = controlState?.owner ?? "nova";
  const observedPowerState: ClimateControlMode =
    controlState?.mode ?? (preferences?.autoMode ? "auto" : entity && isClimateEntityOn(entity) ? "manual" : "off");
  const rememberedHvacMode = preferences?.hvacMode;
  const rememberedMode: AirconMode | null =
    isAirconMode(rememberedHvacMode) && rememberedHvacMode !== "auto" ? rememberedHvacMode : null;
  const observedMode: AirconMode | null =
    entity && isClimateEntityOn(entity) ? airconEntityMode(entity) ?? rememberedMode : null;

  const resolvedPower = resolveCommandedState({
    intent: powerIntent,
    observed: observedPowerState,
    owner: controlOwner,
    now: intentNow,
  });
  const resolvedMode = resolveCommandedState({
    intent: modeIntent,
    observed: observedMode,
    owner: controlOwner,
    now: intentNow,
  });

  useEffect(() => {
    if (powerIntent && !resolvedPower.intent) {
      setPowerIntent(null);
    }
  }, [powerIntent, resolvedPower.intent]);

  useEffect(() => {
    if (modeIntent && !resolvedMode.intent) {
      setModeIntent(null);
    }
  }, [modeIntent, resolvedMode.intent]);

  // While a press is unconfirmed its hold has to be able to time out on its own,
  // not only when a poll happens to land.
  useEffect(() => {
    if (!powerIntent && !modeIntent) {
      return;
    }

    const timer = window.setInterval(() => {
      setIntentNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [powerIntent, modeIntent]);

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

  // Record what a press asked for. Omitting `mode` means the press does not
  // choose a direction — Auto picks its own, so the mode row keeps following the
  // unit rather than being held to a guess.
  const commandControl = (input: { power: ClimateControlMode; mode?: AirconMode | null }) => {
    const sentAt = Date.now();
    setIntentNow(sentAt);
    setPowerIntent({ value: input.power, observedAtPress: observedPowerState, sentAt });
    setModeIntent(
      input.mode === undefined ? null : { value: input.mode, observedAtPress: observedMode, sentAt },
    );
  };

  const isOn = entity ? isClimateEntityOn(entity) : false;
  const supportedModes = entity ? stringListAttribute(entity, "hvac_modes") : [];
  const entityUnavailable = entity ? ["unavailable", "unknown"].includes(entity.state) : true;

  const airconSettings = {
    autoMode: preferences?.autoMode ?? false,
    hvacMode:
      preferences?.hvacMode ??
      (entity && isOn && entity.state !== "off" && entity.state !== "unavailable" && entity.state !== "unknown"
        ? entity.state
        : undefined),
    temperature: selectedTargetTemperature ?? preferredTargetTemperature,
    fanMode: preferences?.fanMode ?? String(entity?.attributes.fan_mode ?? "medium"),
    quietMode: preferences?.quietMode ?? quietSwitch?.state === "on",
    turboMode: preferences?.turboMode ?? turboSwitch?.state === "on",
    // Carried through untouched: Auto's cycle bookkeeping, so the handlers below
    // can read the held direction without reaching past airconSettings.
    autoLastMode: preferences?.autoLastMode ?? null,
    autoLastModeAt: preferences?.autoLastModeAt ?? null,
    autoLastTransitionAt: preferences?.autoLastTransitionAt ?? null,
    autoRecentStartsAt: preferences?.autoRecentStartsAt ?? [],
    autoSettlingFromTemperature: preferences?.autoSettlingFromTemperature ?? null,
  } satisfies AirconPreferences;
  // The selected power state, not the unit's: Auto and Manual both switch the
  // unit OFF at homeostasis, so a resting unit does not mean the user pressed
  // Off. `resolvedPower` lays the last press over the controller's view until
  // the controller catches up, so the highlight always names the last command —
  // this dashboard's or the remote's.
  const activePowerState: ClimateControlMode = resolvedPower.display ?? "off";
  const isControlOn = activePowerState !== "off";
  const activeMode = resolvedMode.display ?? undefined;

  const setOff = () => {
    if (!entity) return Promise.resolve();
    commandControl({ power: "off", mode: null });

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
    if (!entity) return Promise.resolve();
    const actions: EntityActionInput[] = [];
    const preferredMode = isAirconMode(airconSettings.hvacMode) ? airconSettings.hvacMode : undefined;
    const hvacMode =
      preferredMode && airconModeSupported(supportedModes, preferredMode)
        ? preferredMode
        : supportedModes.find((mode) => !["off", "unavailable", "unknown"].includes(mode));

    commandControl({ power: "manual", mode: isAirconMode(hvacMode) ? hvacMode : null });

    if (hvacMode) {
      actions.push({
        entityId: entity.entity_id,
        domain: "climate",
        service: "set_hvac_mode",
        data: { hvac_mode: hvacMode },
        remember: { aircon: { autoMode: false, hvacMode } },
      });
    } else {
      actions.push({ entityId: entity.entity_id, domain: "climate", service: "turn_on" });
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
    if (!entity) return Promise.resolve();
    if (mode === "auto") {
      commandControl({ power: "auto" });

      // R3: arming Auto re-seats the direction, so a previous direction's
      // 30-minute hold does not apply — choosing Auto is an explicit act. The
      // compressor dwell and the hourly start count ARE carried over: those guard
      // the hardware, and a person pressing a button twice must not be able to
      // short-cycle it.
      const actions = buildAirconAutoActions({
        currentTemperature: airconAutoMeasuredTemperature(entity),
        entity,
        forceRemember: true,
        preferences: airconSettings,
        quietSwitch,
        state: { ...airconAutoCycleStateFromPreferences(airconSettings), lastMode: null, lastModeAt: null },
        turboSwitch,
      });

      return callClimateActions(
        actions.length ? actions : [autoPreferenceFallbackAction(entity, airconSettings)],
        onEntityActions,
        "Air Conditioner Auto",
      );
    }

    // R1: picking Heat or Cool by hand is unambiguous. It leaves Auto, and it
    // also seats the direction, so returning to Auto later starts a fresh hold
    // pointing the way the user last asked for rather than the way the loop
    // happened to be going.
    const seatsDirection = mode === "heat" || mode === "cool";

    commandControl({ power: "manual", mode });

    return callClimateActions(
      [
        {
          entityId: entity.entity_id,
          domain: "climate",
          service: "set_hvac_mode",
          data: { hvac_mode: mode },
          remember: {
            aircon: {
              autoMode: false,
              hvacMode: mode,
              ...(seatsDirection ? { autoLastMode: mode, autoLastModeAt: Date.now() } : {}),
            },
          },
        },
      ],
      onEntityActions,
      `Air Conditioner ${label}`,
    );
  };

  const sendTemperature = (temperature: number) => {
    if (!entity) return Promise.resolve();
    // Any explicit setpoint change is fresh human intent. Clear every behavioural
    // guard durably so all clients agree that the next Auto tick may reverse or
    // restart immediately. The separate fresh-input interlock is intentionally
    // not represented here and cannot be cleared by changing a target.
    return callClimateActions(
      [
        {
          entityId: entity.entity_id,
          domain: "climate",
          service: "set_temperature",
          data: { temperature },
          remember: {
            aircon: {
              temperature,
            },
          },
        },
      ],
      onEntityActions,
      `Air Conditioner ${temperature} degrees`,
      { silent: true },
    );
  };

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

  const choosePowerState = (state: "auto" | "manual" | "off") => {
    if (state === "auto") {
      return setMode("auto", "Auto");
    }
    if (state === "manual") {
      return setOn();
    }
    return setOff();
  };

  return {
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
  };
}

// A heater save that never completes used to leave the card showing a state the
// server did not have — tap Off, the POST hangs on a sleeping link, and the card
// reads "Off" indefinitely while the thermostat keeps running. Nothing timed the
// request out and nothing told the user. See
// specs/bedroom-heater-control-integrity.md §2.
const BEDROOM_HEATER_SAVE_TIMEOUT_MS = 8000;

/**
 * Returns what the server now holds, so the card can show that rather than what
 * was tapped. The two agree on a normal save; they diverge when the server
 * clamps a target, and they would diverge silently on any future server-side
 * adjustment. The card follows the server.
 */
export async function saveBedroomHeater(update: BedroomHeaterPreferences): Promise<BedroomHeaterPreferences> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BEDROOM_HEATER_SAVE_TIMEOUT_MS);
  try {
    const response = await fetch("/api/bedroom-heater", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? "Failed to update bedroom heater");
    }
    return (body?.bedroomHeater ?? {}) as BedroomHeaterPreferences;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      // Deliberately not "nothing was changed" — the request may well have
      // reached the server and been applied. Unconfirmed is the honest word,
      // and the card re-syncs from the server rather than guessing.
      throw new Error("Heater did not respond in time — its state is unconfirmed");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The bedroom heater's mode, target and sleep-timer writes.
 *
 * Mode and target were optimistic — applied locally before the server agreed.
 * A heater is not a light: showing "Off" over a running 2 kW element because a
 * POST silently hung is the failure that sent Adeline looking for a schedule
 * that had already been deleted. The card now shows the server's value, plus a
 * pending marker while a save is in flight, and reverts loudly if it fails.
 * See specs/bedroom-heater-control-integrity.md §2.
 */
export function useBedroomHeaterCommands({
  onNotice,
  preferences,
}: {
  onNotice?: (message: string) => void;
  preferences?: BedroomHeaterPreferences;
}) {
  const persistedMode = bedroomHeaterMode(preferences);
  const persistedTarget = bedroomHeaterTargetTemperature(preferences);

  const [mode, setMode] = useState<BedroomHeaterMode>(persistedMode);
  const [target, setTarget] = useState(persistedTarget);
  const [pending, setPending] = useState<{ mode?: BedroomHeaterMode; target?: number } | null>(null);
  const temperatureSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeSaveSequence = useRef(0);

  const persistedTimerEndsAt = typeof preferences?.offTimerEndsAt === "string" ? preferences.offTimerEndsAt : null;
  const [localTimerEndsAt, setLocalTimerEndsAt] = useState<string | null>(persistedTimerEndsAt);

  useEffect(() => {
    setMode(persistedMode);
  }, [persistedMode]);

  useEffect(() => {
    setTarget(persistedTarget);
  }, [persistedTarget]);

  useEffect(() => {
    setLocalTimerEndsAt(persistedTimerEndsAt);
  }, [persistedTimerEndsAt]);

  useEffect(() => {
    return () => {
      if (temperatureSendTimerRef.current) {
        clearTimeout(temperatureSendTimerRef.current);
      }
    };
  }, []);

  // iOS suspends a home-screen web app rather than unmounting it, so the cleanup
  // above never runs when the phone is locked. A debounced target armed in the
  // last two seconds before that would sit frozen and then fire on resume —
  // hours later — writing a stale target over whatever the server held by then.
  // A queued save is discarded on hide; the card re-syncs from the server on
  // resume instead. See specs/bedroom-heater-control-integrity.md §3.
  useEffect(() => {
    const discardQueuedSave = () => {
      if (temperatureSendTimerRef.current) {
        clearTimeout(temperatureSendTimerRef.current);
        temperatureSendTimerRef.current = null;
        setTarget(persistedTarget);
        setPending(null);
      }
    };

    // pagehide gets its own unconditional handler. Gating it on
    // visibilityState === "hidden" made it dead code on exactly the path it
    // exists for: Safari can fire pagehide (bfcache, app quit) without a
    // preceding visibility transition, and that is the suspension that strands
    // a queued save until resume.
    const discardOnHidden = () => {
      if (document.visibilityState === "hidden") discardQueuedSave();
    };

    document.addEventListener("visibilitychange", discardOnHidden);
    window.addEventListener("pagehide", discardQueuedSave);
    return () => {
      document.removeEventListener("visibilitychange", discardOnHidden);
      window.removeEventListener("pagehide", discardQueuedSave);
    };
  }, [persistedTarget]);

  const chooseMode = (next: BedroomHeaterMode) => {
    if (next === mode) {
      return Promise.resolve();
    }
    // Off means the heater is off, so a pending sleep timer has nothing left to
    // do; it would otherwise fire over a later Auto.
    const clearTimer = next === "off" && localTimerEndsAt !== null;
    // Last request wins, not last response. Two quick taps (Auto then Off) fire
    // two independent POSTs; without this the Auto reply landing second would
    // repaint the card to Auto over the user's Off — the card asserting a state
    // the server does not hold, which is the whole failure this spec exists to
    // close. Only the newest tap may write mode.
    const sequence = modeSaveSequence.current + 1;
    modeSaveSequence.current = sequence;
    const isCurrent = () => modeSaveSequence.current === sequence;

    setPending((current) => ({ ...current, mode: next }));
    if (clearTimer) {
      setLocalTimerEndsAt(null);
    }
    // Auto hands over to the server thermostat, which the save evaluates
    // immediately — pressing Auto must not itself force the element on, only
    // ask the thermostat to decide. Off drives the switch directly.
    return saveBedroomHeater(clearTimer ? { mode: next, offTimerEndsAt: null } : { mode: next })
      .then((saved) => {
        if (isCurrent()) setMode(bedroomHeaterMode(saved));
      })
      .catch((error: unknown) => {
        if (!isCurrent()) return;
        setMode(persistedMode);
        if (clearTimer) {
          setLocalTimerEndsAt(persistedTimerEndsAt);
        }
        onNotice?.(
          `Heater ${next === "off" ? "Off" : "Auto"} did not save — still ${persistedMode === "off" ? "Off" : "Auto"}. ${
            error instanceof Error ? error.message : "Save failed"
          }`,
        );
      })
      .finally(() => {
        if (isCurrent()) {
          setPending((current) => (current ? { ...current, mode: undefined } : null));
        }
      });
  };

  // Same debounce shape as the air conditioner's target: only the last value is
  // ever sent, and the auto loop picks it up on its next tick.
  const changeTarget = async (next: number) => {
    const clamped = Math.min(BEDROOM_HEATER_MAX_TARGET_C, Math.max(BEDROOM_HEATER_MIN_TARGET_C, next));
    setPending((current) => ({ ...current, target: clamped }));
    if (temperatureSendTimerRef.current) {
      clearTimeout(temperatureSendTimerRef.current);
    }
    temperatureSendTimerRef.current = setTimeout(() => {
      temperatureSendTimerRef.current = null;
      void saveBedroomHeater({ temperature: clamped })
        .then((saved) => {
          setTarget(bedroomHeaterTargetTemperature(saved));
        })
        .catch((error: unknown) => {
          setTarget(persistedTarget);
          onNotice?.(
            `Heater target did not save — still ${formatTemperature(persistedTarget)}. ${
              error instanceof Error ? error.message : "Save failed"
            }`,
          );
        })
        .finally(() => {
          setPending((current) => (current ? { ...current, target: undefined } : null));
        });
    }, AIRCON_TEMPERATURE_SEND_DEBOUNCE_MS);
  };

  // Expiry is enforced by the unified server climate controller, not
  // here: the whole point of a bedroom sleep timer is that it fires with every
  // dashboard client asleep. This side only sets and displays it.
  const setOffTimer = (offTimerEndsAt: string | null) => {
    setLocalTimerEndsAt(offTimerEndsAt);
    void saveBedroomHeater({ offTimerEndsAt }).catch(() => {
      setLocalTimerEndsAt(persistedTimerEndsAt);
    });
  };

  return {
    changeTarget,
    chooseMode,
    localTimerEndsAt,
    mode,
    /** The target to display: an unsaved tap while it is in flight, else the server's. */
    displayedTarget: pending?.target ?? target,
    setOffTimer,
  };
}
