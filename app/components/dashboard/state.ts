"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardEntity, DashboardPreferences, DashboardState } from "../../../lib/types";
import type { EntityActionInput } from "../../../lib/aircon-control";
import { isClimateEntityOn, stringListAttribute } from "../../../lib/aircon-control";
import { adaptiveCandlelightSpectrum } from "./lighting";
import {
  clamp,
  dashboardEntityIsOn,
  optimisticClimateOnState,
  zoneBrightnessPctFromEntities,
} from "./shared";

type LoadState = "idle" | "loading" | "error";

export async function fetchDashboardStateSnapshot() {
  const response = await fetch("/api/state", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to load dashboard state");
  }
  return payload as DashboardState;
}

export function useDashboardState() {
  const [data, setData] = useState<DashboardState | null>(null);
  const [status, setStatus] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const pollingPausedUntil = useRef(0);
  const eventStreamConnected = useRef(false);
  const eventClientId = useRef<number | null>(null);
  const lastEventFallbackPollAt = useRef(0);

  const pausePolling = useCallback((durationMs: number) => {
    pollingPausedUntil.current = Math.max(pollingPausedUntil.current, Date.now() + durationMs);
  }, []);

  const refresh = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (!force && Date.now() < pollingPausedUntil.current) {
      return null;
    }
    if (force) {
      pollingPausedUntil.current = 0;
    }

    const requestStartedAt = Date.now();
    setStatus((current) => (current === "idle" ? "loading" : current));
    const payload = await fetchDashboardStateSnapshot();
    if (!force && pollingPausedUntil.current > requestStartedAt) {
      setStatus("idle");
      return null;
    }
    setData(payload);
    setError(null);
    setStatus("idle");
    return payload;
  }, []);

  useEffect(() => {
    let alive = true;
    const RELOAD_AFTER_OUTAGE_MS = 8000;
    let firstFailureAt = 0;

    async function load({ force = false, initial = false }: { force?: boolean; initial?: boolean } = {}) {
      if (!force && Date.now() < pollingPausedUntil.current) {
        return;
      }
      if (force) {
        pollingPausedUntil.current = 0;
      }

      try {
        if (initial) {
          setStatus("loading");
        }
        const requestStartedAt = Date.now();
        const payload = await fetchDashboardStateSnapshot();
        if (!force && pollingPausedUntil.current > requestStartedAt) {
          return;
        }
        if (alive) {
          setData(payload);
          setError(null);
          setStatus("idle");
          firstFailureAt = 0;
        }
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : "Failed to load dashboard state");
          setStatus("error");
          const now = Date.now();
          if (firstFailureAt === 0) {
            firstFailureAt = now;
          } else if (now - firstFailureAt >= RELOAD_AFTER_OUTAGE_MS && !document.hidden) {
            window.location.reload();
          }
        }
      }
    }

    load({ force: true, initial: true });
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (eventStreamConnected.current && now - lastEventFallbackPollAt.current < 30_000) {
        return;
      }
      lastEventFallbackPollAt.current = now;
      load();
    }, 7000);
    const refreshVisibleState = () => {
      if (!document.hidden) {
        load({ force: true });
      }
    };

    window.addEventListener("focus", refreshVisibleState);
    window.addEventListener("online", refreshVisibleState);
    window.addEventListener("pageshow", refreshVisibleState);
    document.addEventListener("visibilitychange", refreshVisibleState);

    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisibleState);
      window.removeEventListener("online", refreshVisibleState);
      window.removeEventListener("pageshow", refreshVisibleState);
      document.removeEventListener("visibilitychange", refreshVisibleState);
    };
  }, []);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      return;
    }

    const events = new EventSource("/api/events");

    const handleOpen = () => {
      eventStreamConnected.current = true;
    };
    const handleDisconnect = () => {
      eventStreamConnected.current = false;
    };
    const handleClientId = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { id?: unknown };
        const id = Number(payload.id);
        eventClientId.current = Number.isInteger(id) && id > 0 ? id : null;
      } catch {
        eventClientId.current = null;
      }
    };
    const handleState = (event: MessageEvent) => {
      if (Date.now() < pollingPausedUntil.current) {
        return;
      }

      try {
        const payload = JSON.parse(event.data) as DashboardState;
        setData(payload);
        setError(null);
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to read dashboard event");
      }
    };

    events.addEventListener("open", handleOpen);
    events.addEventListener("error", handleDisconnect);
    events.addEventListener("client-id", handleClientId as EventListener);
    events.addEventListener("state", handleState as EventListener);

    return () => {
      eventStreamConnected.current = false;
      eventClientId.current = null;
      events.removeEventListener("open", handleOpen);
      events.removeEventListener("error", handleDisconnect);
      events.removeEventListener("client-id", handleClientId as EventListener);
      events.removeEventListener("state", handleState as EventListener);
      events.close();
    };
  }, []);

  return { data, status, error, eventClientId, setData, refresh, pausePolling };
}

function withDashboardEntityUpdates(
  data: DashboardState,
  updateEntity: (entity: DashboardEntity) => DashboardEntity,
  preferences = data.preferences,
) {
  const nextEntities = data.entities.map(updateEntity);
  const entitiesChanged = nextEntities.some((entity, index) => entity !== data.entities[index]);
  const entityById = new Map(nextEntities.map((entity) => [entity.entity_id, entity]));
  const nextZones = data.zones.map((zone) => {
    const nextZoneEntities = zone.entities.map((entity) => entityById.get(entity.entity_id) ?? entity);
    const zoneChanged = nextZoneEntities.some((entity, index) => entity !== zone.entities[index]);

    if (!zoneChanged) {
      return zone;
    }

    return {
      ...zone,
      entities: nextZoneEntities,
      isOn: nextZoneEntities.some(dashboardEntityIsOn),
      brightnessPct: zoneBrightnessPctFromEntities(nextZoneEntities),
    };
  });
  const zonesChanged = nextZones.some((zone, index) => zone !== data.zones[index]);

  if (!entitiesChanged && !zonesChanged && preferences === data.preferences) {
    return data;
  }

  return {
    ...data,
    entities: entitiesChanged ? nextEntities : data.entities,
    zones: zonesChanged ? nextZones : data.zones,
    preferences,
  };
}

function brightnessAttributeFromPct(value: unknown) {
  const brightnessPct = Number(value);
  if (!Number.isFinite(brightnessPct)) {
    return null;
  }

  return Math.round((clamp(brightnessPct, 0, 100) / 100) * 255);
}

function optimisticEntityForAction(entity: DashboardEntity, action: EntityActionInput) {
  if (entity.entity_id !== action.entityId || entity.domain !== action.domain) {
    return entity;
  }

  const data = action.data ?? {};
  let state = entity.state;
  let attributes = entity.attributes;
  const setAttributes = (updates: Record<string, unknown>) => {
    attributes = { ...attributes, ...updates };
  };

  if (action.domain === "climate") {
    if (action.service === "turn_off") {
      state = "off";
    } else if (action.service === "turn_on") {
      state = optimisticClimateOnState(entity);
    } else if (action.service === "toggle") {
      state = isClimateEntityOn(entity) ? "off" : optimisticClimateOnState(entity);
    } else if (action.service === "set_hvac_mode" && typeof data.hvac_mode === "string") {
      state = data.hvac_mode;
    } else if (action.service === "set_temperature") {
      const temperature = Number(data.temperature);
      if (Number.isFinite(temperature)) {
        setAttributes({ temperature });
      }
    } else if (action.service === "set_fan_mode" && typeof data.fan_mode === "string") {
      setAttributes({ fan_mode: data.fan_mode });
    } else if (action.service === "set_swing_mode" && typeof data.swing_mode === "string") {
      setAttributes({ swing_mode: data.swing_mode });
    }
  } else if (["light", "switch"].includes(action.domain)) {
    if (action.service === "turn_on") {
      state = "on";
    } else if (action.service === "turn_off") {
      state = "off";
    } else if (action.service === "toggle") {
      state = state === "on" ? "off" : "on";
    }

    if (action.domain === "light") {
      const brightness = brightnessAttributeFromPct(data.brightness_pct);
      if (brightness !== null) {
        setAttributes({ brightness });
      }
      const rgb = Array.isArray(data.rgb_color) && data.rgb_color.length >= 3
        ? data.rgb_color.slice(0, 3).map(Number)
        : null;
      if (rgb?.every(Number.isFinite)) {
        setAttributes({ rgb_color: rgb.slice(0, 3).map((part) => clamp(Math.round(part), 0, 255)) });
      }
    }
  }

  return { ...entity, state, attributes };
}

function withoutUndefinedObject<T extends object>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function optimisticPreferences(current: DashboardPreferences, next: DashboardPreferences) {
  const merged: DashboardPreferences = {
    ...current,
    ...withoutUndefinedObject(next),
  };

  if (next.aircon) {
    merged.aircon = {
      ...(current.aircon ?? {}),
      ...withoutUndefinedObject(next.aircon),
      updatedAt: new Date().toISOString(),
    };
  }

  return merged;
}

export function optimisticStateForEntityActions(data: DashboardState, actions: EntityActionInput[]) {
  return actions.reduce((state, action) => {
    const preferences = action.remember ? optimisticPreferences(state.preferences, action.remember) : state.preferences;
    return withDashboardEntityUpdates(state, (entity) => optimisticEntityForAction(entity, action), preferences);
  }, data);
}

function rgbFromBody(value: unknown) {
  if (!Array.isArray(value) || value.length < 3) {
    return null;
  }

  const rgb = value.slice(0, 3).map(Number);
  return rgb.every(Number.isFinite)
    ? (rgb.slice(0, 3).map((part) => clamp(Math.round(part), 0, 255)) as [number, number, number])
    : null;
}

function optimisticZoneEntity(
  entity: DashboardEntity,
  action: string,
  brightnessPct: number,
  rgb: [number, number, number] | null,
) {
  if (entity.domain === "light") {
    if (action === "off") {
      return { ...entity, state: "off", attributes: { ...entity.attributes, brightness: 0 } };
    }

    if (["on", "brightness", "color", "candlelight", "white"].includes(action)) {
      return {
        ...entity,
        state: "on",
        attributes: {
          ...entity.attributes,
          brightness: Math.round((clamp(brightnessPct, 0, 100) / 100) * 255),
          ...(rgb ? { rgb_color: rgb } : {}),
        },
      };
    }
  }

  if (entity.domain === "switch" && (entity.isIllumination || action === "on")) {
    if (action === "off") {
      return { ...entity, state: "off" };
    }
    if (action === "on") {
      return { ...entity, state: "on" };
    }
  }

  return entity;
}

export function optimisticStateForZoneAction(
  data: DashboardState,
  zoneId: string,
  action: string,
  body: Record<string, unknown>,
) {
  const zone = data.zones.find((candidate) => candidate.id === zoneId);
  if (!zone) {
    return data;
  }

  const entityIds = new Set(zone.entities.map((entity) => entity.entity_id));
  const brightnessPct = clamp(Math.round(Number(body.brightnessPct ?? zone.brightnessPct ?? 100)), 0, 100);
  const rgb =
    rgbFromBody(body.rgb) ??
    (["on", "candlelight"].includes(action) ? adaptiveCandlelightSpectrum(data.sun).preview : null);

  return withDashboardEntityUpdates(data, (entity) =>
    entityIds.has(entity.entity_id) ? optimisticZoneEntity(entity, action, brightnessPct, rgb) : entity,
  );
}

export function isLightZoneAction(action: string) {
  return ["on", "off", "brightness", "color", "candlelight", "white"].includes(action);
}

export function entityActionsAffectLightPolling(actions: EntityActionInput[], data: DashboardState | null) {
  return actions.some((action) => {
    if (action.domain === "light") {
      return true;
    }

    if (action.domain !== "switch" || !data) {
      return false;
    }

    return data.entities.some((entity) => entity.entity_id === action.entityId && entity.isIllumination);
  });
}
