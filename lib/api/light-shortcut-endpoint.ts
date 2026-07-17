import {
  holdDashboardEventLightPolling,
  optimisticDashboardStateForLightingEntityIdsAction,
  publishDashboardState,
} from "../dashboard-events";
import { buildDashboardState, setAllLightingAction, setZoneLightingAction } from "../ha";
import {
  claimLatestLightingCommand,
  INTERACTIVE_LIGHTING_COMMAND_KEY,
  isSupersededLightingCommandError,
} from "../lighting-command-coordinator";
import {
  adaptiveShortcutLightingPreset,
  claimLightShortcutCooldown,
  decideLightShortcutAction,
  findIndoorShortcutZone,
  findOutsideShortcutZone,
  rememberLightShortcutAction,
  shortcutTargetIds,
  shortcutTargetIdsFromEntities,
  startLightShortcutCooldown,
  type LightShortcutAction,
  type LightShortcutTarget,
} from "../light-shortcuts";
import { emitDashboardEvent } from "../event-spool";
import type { DashboardState, DashboardZone } from "../types";

type LightShortcutRequestAction = LightShortcutAction | "toggle";

type LightShortcutDefinition = {
  emptyMessage: string;
  errorMessage: string;
  findZone: (state: DashboardState) => DashboardZone | null;
  mode: "adaptive" | "power";
  target: LightShortcutTarget;
  zoneMissingMessage: string;
};

const SHORTCUTS: Record<Exclude<LightShortcutTarget, "all">, LightShortcutDefinition> = {
  indoors: {
    emptyMessage: "No indoor lights available",
    errorMessage: "Indoor light shortcut failed",
    findZone: findIndoorShortcutZone,
    mode: "adaptive",
    target: "indoors",
    zoneMissingMessage: "Indoor lighting zone not found",
  },
  outside: {
    emptyMessage: "No outside light available",
    errorMessage: "Outside light shortcut failed",
    findZone: findOutsideShortcutZone,
    mode: "power",
    target: "outside",
    zoneMissingMessage: "Outside lighting zone not found",
  },
};

function traceId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function text(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export async function handleLightShortcut(target: LightShortcutTarget, requestedAction: LightShortcutRequestAction) {
  const explicitAction = requestedAction === "toggle" ? null : requestedAction;
  const fallbackErrorMessage = target === "all" ? "All light shortcut failed" : SHORTCUTS[target].errorMessage;
  const cooldown = claimLightShortcutCooldown(target);
  if (!cooldown.allowed) {
    if (!explicitAction || cooldown.lastAction === explicitAction) {
      return cooldown.lastAction ? text(cooldown.lastAction) : text("cooldown", 429);
    }
    startLightShortcutCooldown(target);
  }
  const latestClaim = claimLatestLightingCommand([INTERACTIVE_LIGHTING_COMMAND_KEY, `shortcut:${target}`]);
  const eventName = target === "all" ? "all-lights" : "zone-lights";

  try {
    const dashboard = await buildDashboardState();
    if (target === "all") {
      const decision = decideLightShortcutAction(dashboard.entities);
      if (decision.total === 0) {
        return text("No lights available", 404);
      }

      const action = explicitAction ?? decision.action;
      const targetIds = shortcutTargetIdsFromEntities(dashboard.entities);
      const preset = adaptiveShortcutLightingPreset(dashboard.sun);
      // START of the multi-device "all lights" operation.
      void emitDashboardEvent({
        service: "lighting",
        event: eventName,
        source: "user",
        phase: "start",
        detail: { target, action, lights: targetIds.length, brightnessPct: preset.brightnessPct },
      });
      const state = await setAllLightingAction({
        action,
        brightnessPct: preset.brightnessPct,
        entityIds: targetIds,
        isCurrent: latestClaim.isCurrent,
        mode: "adaptive",
        traceId: traceId(),
      });
      latestClaim.assertCurrent();

      holdDashboardEventLightPolling();
      publishDashboardState(
        optimisticDashboardStateForLightingEntityIdsAction(state, {
          action,
          brightnessPct: preset.brightnessPct,
          entityIds: targetIds,
          rgb: preset.rgb,
        }),
        { force: true },
      );
      rememberLightShortcutAction(target, action);

      // FINISH.
      void emitDashboardEvent({
        service: "lighting",
        event: eventName,
        source: "user",
        phase: "end",
        detail: { target, action, lights: targetIds.length, outcome: "ok" },
      });
      return text(action);
    }

    const definition = SHORTCUTS[target];
    const zone = definition.findZone(dashboard);
    if (!zone) {
      return text(definition.zoneMissingMessage, 404);
    }

    const decision = decideLightShortcutAction(zone.entities);
    if (decision.total === 0) {
      return text(definition.emptyMessage, 404);
    }

    const action = explicitAction ?? decision.action;
    const targetIds = shortcutTargetIds(zone);
    const preset = adaptiveShortcutLightingPreset(dashboard.sun);
    void emitDashboardEvent({
      service: "lighting",
      event: eventName,
      source: "user",
      phase: "start",
      detail: { target, zone: zone.id, action, lights: targetIds.length },
    });
    const state = await setZoneLightingAction({
      action,
      brightnessPct: definition.mode === "adaptive" ? preset.brightnessPct : undefined,
      entityIds: targetIds,
      isCurrent: latestClaim.isCurrent,
      mode: definition.mode,
      traceId: traceId(),
      zoneId: zone.id,
    });
    latestClaim.assertCurrent();

    holdDashboardEventLightPolling();
    if (definition.mode === "adaptive") {
      publishDashboardState(
        optimisticDashboardStateForLightingEntityIdsAction(state, {
          action,
          brightnessPct: preset.brightnessPct,
          entityIds: targetIds,
          rgb: preset.rgb,
        }),
        { force: true },
      );
    } else {
      publishDashboardState(state, { force: true });
    }
    rememberLightShortcutAction(target, action);

    void emitDashboardEvent({
      service: "lighting",
      event: eventName,
      source: "user",
      phase: "end",
      detail: { target, zone: zone.id, action, lights: targetIds.length, outcome: "ok" },
    });
    return text(action);
  } catch (error) {
    const superseded = isSupersededLightingCommandError(error);
    void emitDashboardEvent({
      service: "lighting",
      event: eventName,
      source: "user",
      phase: "end",
      detail: { target, outcome: superseded ? "superseded" : "error" },
    });
    if (superseded) {
      return text("superseded", 202);
    }

    return text(error instanceof Error ? error.message : fallbackErrorMessage, 500);
  }
}
