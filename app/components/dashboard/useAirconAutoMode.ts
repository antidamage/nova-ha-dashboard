"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { DashboardState } from "../../../lib/types";
import {
  AIRCON_AUTO_POLL_MS,
  AirconAutoThermostat,
  airconAutoCycleStateFromPreferences,
  airconAutoMeasuredTemperature,
  type AirconAutoReason,
  type EntityActionInput,
} from "../../../lib/aircon-control";
import { climateDevicesForZone, isClimateZone } from "./shared";
import { emitClientEvent } from "./emitClientEvent";
import type { ApplyEntityActionsOptions } from "./useDashboardCommands";

/** Planner outcomes worth a monitoring event even though they send nothing. */
const AIRCON_HELD_REASONS: AirconAutoReason[] = ["mode-hold", "min-cycle-hold", "starts-per-hour-hold"];

export function useAirconAutoMode({
  applyEntityActions,
  data,
  isPollingPaused,
  setData,
}: {
  applyEntityActions: (actions: EntityActionInput[], toastMessage: string, options?: ApplyEntityActionsOptions) => Promise<void>;
  data: DashboardState | null;
  // Shared command-cooldown predicate from useDashboardState. See the POLLING COOLDOWN
  // CONTRACT comment in state.ts — this hook polls outside of `refresh`, so it MUST
  // honour the cooldown itself or it reintroduces the optimistic-state flicker.
  isPollingPaused: () => boolean;
  setData: Dispatch<SetStateAction<DashboardState | null>>;
}) {
  const latestData = useRef<DashboardState | null>(null);
  const airconAutoThermostatRef = useRef<AirconAutoThermostat | null>(null);
  const applyEntityActionsRef = useRef<((actions: EntityActionInput[], toastMessage: string, options?: ApplyEntityActionsOptions) => Promise<void>) | null>(null);
  const lastHeldReasonRef = useRef<AirconAutoReason | null>(null);
  airconAutoThermostatRef.current ??= new AirconAutoThermostat();

  useEffect(() => {
    latestData.current = data;
  }, [data]);

  useEffect(() => {
    applyEntityActionsRef.current = applyEntityActions;
  }, [applyEntityActions]);

  const airconAutoMode = data?.preferences.aircon?.autoMode ?? false;

  useEffect(() => {
    if (!airconAutoMode) {
      // NOT reset(): the dwell, the direction hold and the hourly start count
      // describe the compressor, not Auto's mode, and must survive Auto being
      // switched off and on again. Wiping them here is how the bedroom heater
      // came to flap its relay three times in twelve seconds (2026-08-08).
      airconAutoThermostatRef.current?.resetForUserRequest();
      lastHeldReasonRef.current = null;
      return;
    }

    let alive = true;
    let applying = false;

    const runAuto = async () => {
      if (!alive || applying || document.hidden) {
        return;
      }

      // The dashboard is king. While a user command is in its cooldown window the
      // auto loop stands down completely: the user just pressed on/auto/off and
      // that intent (and its optimistically-remembered autoMode) must win. Acting
      // on a freshly-fetched snapshot here would re-issue commands that undo a
      // just-pressed Off before autoMode:false has propagated to the server.
      if (isPollingPaused()) {
        return;
      }

      applying = true;
      // Decide from the shared snapshot, do NOT fetch one per tick. This loop
      // used to call fetchDashboardStateSnapshot() every AIRCON_AUTO_POLL_MS
      // (1s) — a full /api/state build per second PER CLIENT, which kept
      // next-server pegged and starved the browser's per-origin connection
      // pool (2026-07-11 soft outage). `latestData` is already kept fresh by
      // the SSE state push (every HA change) and useDashboardState's 5s poll;
      // a room thermostat's time constants are minutes, so ≤5s-stale input is
      // more than enough. The cooldown guards above/below are unchanged — see
      // the POLLING COOLDOWN CONTRACT in state.ts. DO NOT reintroduce a
      // per-tick fetch here.
      const snapshot = latestData.current;

      const currentClimateZone = snapshot?.zones.find(isClimateZone) ?? null;
      const { aircon, quietSwitch, turboSwitch } = climateDevicesForZone(currentClimateZone);
      const measuredTemperature = airconAutoMeasuredTemperature(aircon);
      // Fold in the durable copy of the dwell / direction hold / hourly start
      // count before deciding. This ref is per browser tab and dies with a
      // reload; the guards it holds are measured in tens of minutes, so they have
      // to come from somewhere shared or they never fire in practice.
      airconAutoThermostatRef.current!.reconcile(
        airconAutoCycleStateFromPreferences(snapshot?.preferences.aircon),
      );
      const { actions, reason, wantedMode } = airconAutoThermostatRef.current!.plan({
        currentTemperature: measuredTemperature,
        entity: aircon,
        preferences: snapshot?.preferences.aircon,
        quietSwitch,
        turboSwitch,
      });

      if (!actions.length) {
        // A tick that was BLOCKED is the interesting one, and it emits no actions
        // to be logged by the path below. Report it once per change of reason —
        // the loop ticks every second, so anything per-tick would be a flood.
        if (AIRCON_HELD_REASONS.includes(reason) && lastHeldReasonRef.current !== reason) {
          emitClientEvent({
            service: "climate",
            event: "aircon-auto-held",
            source: "auto",
            detail: {
              reason,
              wantedMode,
              sensor: measuredTemperature ?? undefined,
              target: snapshot?.preferences.aircon?.temperature,
              priorMode: aircon?.state,
            },
          });
        }
        lastHeldReasonRef.current = reason;
        applying = false;
        return;
      }
      lastHeldReasonRef.current = null;

      // Re-check authority right before sending: a user on/auto/off pressed during
      // the awaited fetch above will have started a fresh cooldown and/or cleared
      // autoMode optimistically. In either case the user wins — drop these actions
      // so we never resurrect a unit the user just turned off.
      if (isPollingPaused() || !(latestData.current?.preferences.aircon?.autoMode ?? false)) {
        applying = false;
        return;
      }

      // Attribute the autonomous action into the monitoring stream with the
      // homeostasis reasoning that only this client loop has (target vs measured,
      // prior mode, and whether it's the "turned OFF at homeostasis" case).
      //
      // `reason` and `wantedMode` are what make a reversal visible here. Without
      // them this event recorded which services went out but never which
      // direction was wanted, so the 2026-08-09 flip-flop had to be
      // reconstructed from Home Assistant's own history instead.
      const targetTemperature = snapshot?.preferences.aircon?.temperature;
      const turnedOff = actions.some((entityAction) => entityAction.service === "turn_off");
      emitClientEvent({
        service: "climate",
        event: "aircon-auto",
        source: "auto",
        detail: {
          actions: actions.map((entityAction) => entityAction.service).join(","),
          turnedOff,
          sensor: measuredTemperature ?? undefined,
          target: targetTemperature,
          delta:
            measuredTemperature != null && targetTemperature != null
              ? Math.round((measuredTemperature - targetTemperature) * 10) / 10
              : undefined,
          priorMode: aircon?.state,
          reason,
          wantedMode,
        },
      });

      try {
        await applyEntityActionsRef.current?.(actions, "Air Conditioner auto", { silent: true });
      } finally {
        applying = false;
      }
    };

    void runAuto();
    const timer = window.setInterval(runAuto, AIRCON_AUTO_POLL_MS);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [airconAutoMode, setData]);
}
