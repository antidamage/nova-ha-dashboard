"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardEntity, DashboardLightingConfig, DashboardPreferences, DashboardState } from "../../../lib/types";
import type { EntityActionInput } from "../../../lib/aircon-control";
import { isClimateEntityOn, stringListAttribute } from "../../../lib/aircon-control";
import { isEntitySuppressedByIntensity } from "../../../lib/lighting-thresholds";
import { subscribeToDashboardEvents } from "../sharedDashboardEvents";
import { isControlInteractionCoolingDown } from "../controlInteractionCooldown";
import { emitClientEvent } from "./emitClientEvent";
import { arePageUpdatesPaused, subscribePageUpdatePause } from "./pageUpdatePause";
import { adaptiveCandlelightSpectrum } from "./lighting";
import {
  clamp,
  dashboardEntityIsOn,
  optimisticClimateOnState,
  zoneBrightnessPctFromEntities,
} from "./shared";

type LoadState = "idle" | "loading" | "error";

// Abort rather than hang: over HTTP/1.1 the browser caps concurrent connections
// per origin (~6), and a snapshot request that never settles (server mid-boot,
// contended box) occupies one of those slots forever. Enough zombies and every
// later request — new polls, /api/update health checks, even the SSE reconnect —
// queues behind them with no recovery path. The 2026-07-11 kiosk soft outage
// ("Loading zone controls" for 70+ minutes while the server was healthy) was
// this. A hard timeout turns a hung request into an ordinary retryable error.
const SNAPSHOT_FETCH_TIMEOUT_MS = 15_000;

export async function fetchDashboardStateSnapshot() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SNAPSHOT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch("/api/state", { cache: "no-store", signal: controller.signal });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load dashboard state");
    }
    return payload as DashboardState;
  } finally {
    clearTimeout(timeout);
  }
}

export function useDashboardState() {
  const [data, setData] = useState<DashboardState | null>(null);
  const [status, setStatus] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const pollingPausedUntil = useRef(0);
  const eventStreamConnected = useRef(false);
  const eventClientId = useRef<number | null>(null);
  // Last time a server snapshot actually reached us via ANY path (initial load,
  // background poll, explicit refresh, SSE push). Feeds the stall-reload
  // watchdog below; seeded with mount time so a fresh page gets the full grace
  // period before it may conclude it is wedged.
  const lastSnapshotAt = useRef(Date.now());
  const hasDashboardData = useRef(false);
  const pendingScrollSnapshot = useRef<DashboardState | null>(null);

  // Server updates are non-urgent during a scroll. Keep receiving them so the
  // connection stays healthy, but collapse them to the newest snapshot and
  // avoid a large dashboard reconciliation on the input-critical path.
  const commitServerSnapshot = useCallback((payload: DashboardState) => {
    if (arePageUpdatesPaused() && hasDashboardData.current) {
      pendingScrollSnapshot.current = payload;
      return;
    }
    pendingScrollSnapshot.current = null;
    hasDashboardData.current = true;
    setData(payload);
  }, []);

  useEffect(() => subscribePageUpdatePause((paused) => {
    if (paused || !pendingScrollSnapshot.current) return;
    const payload = pendingScrollSnapshot.current;
    pendingScrollSnapshot.current = null;
    hasDashboardData.current = true;
    setData(payload);
  }), []);

  // Every real device doubles as an outage probe: when a snapshot finally lands
  // after a long gap, report how long the client was cut off. These attributed
  // events flow into the monitoring stream and are the only external evidence
  // of "nova was unreachable from the LAN" episodes that leave no server-side
  // trace (WiFi path drops, wedged connections). Fire-and-forget; never blocks.
  const CLIENT_GAP_REPORT_MS = 60_000;
  const markSnapshotArrived = useCallback(() => {
    const previousAt = lastSnapshotAt.current;
    const nowMs = Date.now();
    lastSnapshotAt.current = nowMs;
    const gapMs = nowMs - previousAt;
    if (gapMs >= CLIENT_GAP_REPORT_MS) {
      emitClientEvent({
        service: "network",
        event: "client-connection-gap",
        source: "client",
        detail: { gapMs, gapSeconds: Math.round(gapMs / 1000) },
      });
    }
  }, []);

  // === POLLING COOLDOWN CONTRACT — DO NOT REMOVE (regressed 3x by refactors) ===
  // After a user changes an entity (temperature, on/off, brightness, etc.) the UI is
  // updated optimistically. Home Assistant takes up to a second or two to actually
  // apply the change and echo it back, so any state we poll/receive during that window
  // still carries the OLD value. If we let that stale snapshot overwrite the optimistic
  // value the user sees the control briefly snap back to the previous value and then
  // jump to the correct value once HA catches up — the exact "revert then re-update"
  // flicker we are guarding against.
  //
  // `pausePolling(ms)` sets a deadline; EVERY code path that pushes a *server* snapshot
  // into `setData` MUST honour it (see `refresh`, the background poll loop, the SSE
  // handler, and `useAirconAutoMode`). `isPollingPaused()` is the shared predicate for
  // callers that fetch outside of `refresh`. If you add a new poller, gate its `setData`
  // on `isPollingPaused()` or you WILL reintroduce the flicker.
  const pausePolling = useCallback((durationMs: number) => {
    pollingPausedUntil.current = Math.max(pollingPausedUntil.current, Date.now() + durationMs);
  }, []);

  // True while a user-initiated command cooldown is still active. Callers that fetch a
  // server snapshot outside of `refresh` must check this before calling `setData`.
  const isPollingPaused = useCallback(
    () => isControlInteractionCoolingDown() || Date.now() < pollingPausedUntil.current,
    [],
  );

  const refresh = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    // Cooldown guard — see POLLING COOLDOWN CONTRACT above. `force` is only for explicit
    // user-driven refreshes that should bypass the cooldown.
    if (isControlInteractionCoolingDown() || (!force && Date.now() < pollingPausedUntil.current)) {
      return null;
    }
    if (force) {
      pollingPausedUntil.current = 0;
    }

    const requestStartedAt = Date.now();
    setStatus((current) => (current === "idle" ? "loading" : current));
    const payload = await fetchDashboardStateSnapshot();
    markSnapshotArrived();
    if (isControlInteractionCoolingDown() || (!force && pollingPausedUntil.current > requestStartedAt)) {
      setStatus("idle");
      return null;
    }
    commitServerSnapshot(payload);
    setError(null);
    setStatus("idle");
    return payload;
  }, []);

  useEffect(() => {
    let alive = true;
    // One snapshot request at a time: a slow request must not let the 5s tick
    // stack further connections behind it (see SNAPSHOT_FETCH_TIMEOUT_MS — the
    // per-origin pool is the scarce resource being protected).
    let loadInFlight = false;

    async function load({ force = false, initial = false }: { force?: boolean; initial?: boolean } = {}) {
      // Background poll loop — honours the command cooldown (POLLING COOLDOWN CONTRACT above).
      if (loadInFlight) {
        return;
      }
      if (isControlInteractionCoolingDown() || (!force && Date.now() < pollingPausedUntil.current)) {
        return;
      }
      if (force) {
        pollingPausedUntil.current = 0;
      }

      loadInFlight = true;
      try {
        if (initial) {
          setStatus("loading");
        }
        const requestStartedAt = Date.now();
        const payload = await fetchDashboardStateSnapshot();
        markSnapshotArrived();
        if (isControlInteractionCoolingDown() || (!force && pollingPausedUntil.current > requestStartedAt)) {
          return;
        }
        if (alive) {
          commitServerSnapshot(payload);
          setError(null);
          setStatus("idle");
        }
      } catch (err) {
        // Show the error and keep polling — no reload. Reloading here used to
        // fire after just 8s of failed fetches, which turned every transient
        // stall (contended box) and every HA outage (/api/state 500s while the
        // dashboard itself is fine) into a reload loop. Real dashboard outages
        // are covered by SystemActivityBlocker, and stale-build pickup by
        // useBuildReload.
        if (alive) {
          setError(err instanceof Error ? err.message : "Failed to load dashboard state");
          setStatus("error");
        }
      } finally {
        loadInFlight = false;
      }
    }

    load({ force: true, initial: true });
    const timer = window.setInterval(() => {
      load();
    }, 5000);
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

    const unsubscribe = subscribeToDashboardEvents({
      open: () => {
        eventStreamConnected.current = true;
      },
      error: () => {
        eventStreamConnected.current = false;
      },
      "client-id": (event) => {
        try {
          const payload = JSON.parse(event.data) as { id?: unknown };
          const id = Number(payload.id);
          eventClientId.current = Number.isInteger(id) && id > 0 ? id : null;
        } catch {
          eventClientId.current = null;
        }
      },
      state: (event) => {
        // A state push arriving proves the pipeline is alive even when the
        // cooldown below declines to apply it — count it for the stall watchdog.
        markSnapshotArrived();
        // SSE-pushed snapshots also honour the command cooldown (POLLING COOLDOWN CONTRACT
        // above): a server push right after a user command still carries HA's stale state.
        if (isControlInteractionCoolingDown() || Date.now() < pollingPausedUntil.current) {
          return;
        }

        try {
          const payload = JSON.parse(event.data) as DashboardState;
          commitServerSnapshot(payload);
          setError(null);
          setStatus("idle");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to read dashboard event");
        }
      },
    });

    return () => {
      eventStreamConnected.current = false;
      eventClientId.current = null;
      unsubscribe();
    };
  }, []);

  // === STALL RELOAD — deliberate last resort, keep the trigger conservative ===
  // A kiosk-style client never fires the focus/online/pageshow events that force
  // a refresh, so if the poll loop and the SSE stream BOTH wedge (2026-07-11:
  // hung connection pool + silently dead EventSource → "Loading zone controls"
  // for 70+ minutes against a healthy server) nothing above ever recovers the
  // page. If no server snapshot has arrived by any path for STALL_RELOAD_AFTER_MS
  // while the page is visible, reload once. This is NOT the old 8s reload-loop
  // (see the poll loop's catch): with fetch timeouts in place transient stalls
  // surface as retryable errors well inside the window, and the localStorage
  // stamp caps a genuinely dead server at one reload per STALL_RELOAD_MIN_GAP_MS.
  useEffect(() => {
    const STALL_RELOAD_AFTER_MS = 5 * 60_000;
    const STALL_RELOAD_MIN_GAP_MS = 15 * 60_000;
    const STALL_RELOAD_STAMP_KEY = "nova.dashboard.stallReloadAt.v1";

    const timer = window.setInterval(() => {
      if (document.hidden) {
        return;
      }
      if (Date.now() - lastSnapshotAt.current < STALL_RELOAD_AFTER_MS) {
        return;
      }
      let lastReloadAt = 0;
      try {
        lastReloadAt = Number(window.localStorage.getItem(STALL_RELOAD_STAMP_KEY)) || 0;
      } catch {
        // Storage unavailable — still reload, just without loop protection.
      }
      if (Date.now() - lastReloadAt < STALL_RELOAD_MIN_GAP_MS) {
        return;
      }
      try {
        window.localStorage.setItem(STALL_RELOAD_STAMP_KEY, String(Date.now()));
      } catch {
        // Ignore: reloading matters more than stamping.
      }
      window.location.reload();
    }, 30_000);

    return () => window.clearInterval(timer);
  }, []);

  return { data, status, error, eventClientId, setData, refresh, pausePolling, isPollingPaused };
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

  if (next.panelHeater) {
    merged.panelHeater = {
      ...(current.panelHeater ?? {}),
      ...withoutUndefinedObject(next.panelHeater),
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
  lighting?: DashboardLightingConfig,
) {
  if (action !== "off" && isEntitySuppressedByIntensity(entity, brightnessPct, lighting)) {
    if (entity.domain === "light") {
      return { ...entity, state: "off", attributes: { ...entity.attributes, brightness: 0 } };
    }
    if (entity.domain === "switch") {
      return { ...entity, state: "off" };
    }
  }

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
    entityIds.has(entity.entity_id) ? optimisticZoneEntity(entity, action, brightnessPct, rgb, data.lighting) : entity,
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
