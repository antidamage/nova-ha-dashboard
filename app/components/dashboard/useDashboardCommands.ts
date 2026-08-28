"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { DashboardState, DashboardZone } from "../../../lib/types";
import type { EntityActionInput } from "../../../lib/aircon-control";
import { LIGHT_COMMAND_POLL_HOLD_MS } from "./lighting";
import {
  entityActionsAffectLightPolling,
  isLightZoneAction,
  optimisticStateForEntityActions,
  optimisticStateForZoneAction,
} from "./state";
import { isClimateZone } from "./shared";
import { useModuleIntercepts } from "../modules/ModuleHost";

export type ApplyEntityActionsOptions = {
  // Retained for call-site compatibility. Interaction feedback now comes from
  // the originating button or slider, so delayed/background commands are
  // naturally silent.
  silent?: boolean;
};

// Every user command holds the poll/SSE cooldown (see the POLLING COOLDOWN
// CONTRACT in state.ts) for at least six seconds after the control is used, so a
// snapshot that still carries HA's pre-change value cannot snap the control back
// (the "rubber-band"). Slower devices (Tuya climate, cloud-bridged switches) can
// take several seconds to echo the new state; the previous 2s/5s holds expired
// before that and let the reconcile poll clobber the optimistic value. Lights
// already hold 10s (LIGHT_COMMAND_POLL_HOLD_MS). The reconcile poll fires at
// hold + 100ms, so it lands just after the window — the first snapshot we accept
// is the one that already reflects the command.
const ENTITY_COMMAND_HOLD_MS = 6000;
const ENTITY_COMMAND_POLL_DELAYS_MS = [ENTITY_COMMAND_HOLD_MS + 100] as const;
const CLIMATE_COMMAND_HOLD_MS = 6000;
const CLIMATE_COMMAND_POLL_DELAYS_MS = [CLIMATE_COMMAND_HOLD_MS + 100] as const;

type RefreshDashboardState = (options?: { force?: boolean }) => Promise<DashboardState | null>;

function entityActionsAffectClimatePolling(actions: EntityActionInput[]) {
  return actions.some((action) => action.domain === "climate");
}

export function useDashboardCommands({
  data,
  eventClientId,
  pausePolling,
  refresh,
  selectedZone,
  setData,
  setToast,
}: {
  data: DashboardState | null;
  eventClientId: MutableRefObject<number | null>;
  pausePolling: (durationMs: number) => void;
  refresh: RefreshDashboardState;
  selectedZone: DashboardZone | null;
  setData: Dispatch<SetStateAction<DashboardState | null>>;
  setToast: Dispatch<SetStateAction<string | null>>;
}) {
  const runModuleIntercepts = useModuleIntercepts();
  const [desktopSleepBusy, setDesktopSleepBusy] = useState(false);
  const [desktopWakeBusy, setDesktopWakeBusy] = useState(false);
  const entityActionSequence = useRef(0);
  const zoneActionSequence = useRef(0);
  const entityPollTimers = useRef<number[]>([]);
  const lightResumePollTimer = useRef<number | null>(null);
  const zoneLightAbortController = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      entityPollTimers.current.forEach(window.clearTimeout);
      if (lightResumePollTimer.current !== null) {
        window.clearTimeout(lightResumePollTimer.current);
      }
      zoneLightAbortController.current?.abort();
    };
  }, []);

  const scheduleLightResumePoll = useCallback(() => {
    if (lightResumePollTimer.current !== null) {
      window.clearTimeout(lightResumePollTimer.current);
    }

    lightResumePollTimer.current = window.setTimeout(() => {
      lightResumePollTimer.current = null;
      void refresh().catch(() => undefined);
    }, LIGHT_COMMAND_POLL_HOLD_MS + 100);
  }, [refresh]);

  const scheduleEntityCommandPolls = useCallback(
    (sequence: number, delaysMs: readonly number[]) => {
      entityPollTimers.current.forEach(window.clearTimeout);
      entityPollTimers.current = delaysMs.map((delay) =>
        window.setTimeout(() => {
          if (sequence === entityActionSequence.current) {
            void refresh().catch(() => undefined);
          }
        }, delay),
      );
    },
    [refresh],
  );

  useEffect(() => {
    if (!selectedZone || !isClimateZone(selectedZone)) {
      return;
    }

    let alive = true;
    const load = () => {
      if (!alive || document.hidden) {
        return;
      }
      refresh().catch(() => undefined);
    };

    load();
    const timer = window.setInterval(load, 3000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refresh, selectedZone?.id]);

  const applyZoneAction = useCallback(
    async (action: string, body: Record<string, unknown> = {}) => {
      if (!selectedZone) {
        return;
      }

      // Module interceptors run BEFORE the optimistic write and the poll hold,
      // so a cancelled action leaves neither behind.
      const proceed = await runModuleIntercepts({
        id: "zone.action",
        source: "client",
        zone: { id: selectedZone.id, name: selectedZone.name },
        service: action,
        data: body,
      });
      if (!proceed) {
        return;
      }

      const sequence = zoneActionSequence.current + 1;
      zoneActionSequence.current = sequence;
      const holdLightPolling = isLightZoneAction(action);

      if (holdLightPolling) {
        pausePolling(LIGHT_COMMAND_POLL_HOLD_MS);
        setData((current) =>
          current ? optimisticStateForZoneAction(current, selectedZone.id, action, body) : current,
        );
      }

      const controller = holdLightPolling ? new AbortController() : null;
      if (controller) {
        zoneLightAbortController.current?.abort();
        zoneLightAbortController.current = controller;
      }

      try {
        const response = await fetch("/api/zone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zoneId: selectedZone.id, action, sourceClientId: eventClientId.current, ...body }),
          signal: controller?.signal,
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Zone action failed");
        }

        if (sequence !== zoneActionSequence.current) {
          return;
        }

        if (holdLightPolling) {
          pausePolling(LIGHT_COMMAND_POLL_HOLD_MS);
          scheduleLightResumePoll();
        } else {
          setData(payload);
        }

        setToast(`${selectedZone.name}: ${action}`);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        if (sequence === zoneActionSequence.current) {
          setToast(err instanceof Error ? err.message : "Zone action failed");
          if (holdLightPolling) {
            void refresh({ force: true }).catch(() => undefined);
          }
        }
      } finally {
        if (controller && zoneLightAbortController.current === controller) {
          zoneLightAbortController.current = null;
        }
      }
    },
    [eventClientId, pausePolling, refresh, runModuleIntercepts, scheduleLightResumePoll, selectedZone, setData, setToast],
  );

  const applyEntityActions = useCallback(
    async (actions: EntityActionInput[], toastMessage: string, _options?: ApplyEntityActionsOptions) => {
      if (!actions.length) {
        return;
      }

      // One decision for the whole batch: the actions in a batch are one user
      // gesture, so confirming them individually would ask the same question
      // several times for a single press.
      const first = actions[0];
      const proceed = await runModuleIntercepts({
        id: "entity.action",
        source: "client",
        entity: {
          id: first.entityId,
          domain: first.domain,
          friendlyName: data?.entities.find((entity) => entity.entity_id === first.entityId)?.name,
          state: data?.entities.find((entity) => entity.entity_id === first.entityId)?.state,
        },
        service: first.service,
        data: { actions: actions.map(({ entityId, domain, service }) => ({ entityId, domain, service })) },
      });
      if (!proceed) {
        return;
      }

      const sequence = entityActionSequence.current + 1;
      entityActionSequence.current = sequence;
      const holdLightPolling = entityActionsAffectLightPolling(actions, data);
      const holdClimatePolling = entityActionsAffectClimatePolling(actions);
      const commandHoldMs = holdLightPolling
        ? LIGHT_COMMAND_POLL_HOLD_MS
        : holdClimatePolling
          ? CLIMATE_COMMAND_HOLD_MS
          : ENTITY_COMMAND_HOLD_MS;

      pausePolling(commandHoldMs);
      setData((current) => (current ? optimisticStateForEntityActions(current, actions) : current));

      try {
        for (const action of actions) {
          const response = await fetch("/api/entity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...action, sourceClientId: eventClientId.current }),
          });
          const body = await response.json();
          if (!response.ok) {
            throw new Error(body.error ?? "Entity action failed");
          }
        }

        if (sequence !== entityActionSequence.current) {
          return;
        }

        if (holdLightPolling) {
          pausePolling(LIGHT_COMMAND_POLL_HOLD_MS);
          scheduleLightResumePoll();
        } else {
          pausePolling(commandHoldMs);
          scheduleEntityCommandPolls(
            sequence,
            holdClimatePolling ? CLIMATE_COMMAND_POLL_DELAYS_MS : ENTITY_COMMAND_POLL_DELAYS_MS,
          );
        }

        setToast(toastMessage);
      } catch (err) {
        if (sequence === entityActionSequence.current) {
          setToast(err instanceof Error ? err.message : "Entity action failed");
          void refresh({ force: true }).catch(() => undefined);
        }
      }
    },
    [data, eventClientId, pausePolling, refresh, runModuleIntercepts, scheduleEntityCommandPolls, scheduleLightResumePoll, setData, setToast],
  );

  const applyDesktopSleep = useCallback(
    async (computer: { id: string; name: string }) => {
      if (desktopSleepBusy) {
        return;
      }

      setDesktopSleepBusy(true);

      try {
        const response = await fetch("/api/desktop/sleep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: computer.id, sourceClientId: eventClientId.current }),
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? "Desktop sleep action failed");
        }

        setToast(`${computer.name}: sleep`);
      } catch (err) {
        setToast(err instanceof Error ? err.message : "Desktop sleep action failed");
      } finally {
        setDesktopSleepBusy(false);
      }
    },
    [desktopSleepBusy, eventClientId, setToast],
  );

  const applyDesktopWake = useCallback(
    async (computer: { id: string; name: string }) => {
      if (desktopWakeBusy) {
        return;
      }

      setDesktopWakeBusy(true);

      try {
        const response = await fetch("/api/desktop/wake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: computer.id, sourceClientId: eventClientId.current }),
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? "Desktop wake action failed");
        }

        setToast(`${computer.name}: wake`);
      } catch (err) {
        setToast(err instanceof Error ? err.message : "Desktop wake action failed");
      } finally {
        setDesktopWakeBusy(false);
      }
    },
    [desktopWakeBusy, eventClientId, setToast],
  );

  return {
    applyDesktopSleep,
    applyDesktopWake,
    applyEntityActions,
    applyZoneAction,
    desktopSleepBusy,
    desktopWakeBusy,
  };
}
