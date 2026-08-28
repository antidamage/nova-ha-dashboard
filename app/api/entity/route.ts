import { NextResponse } from "next/server";
import {
  entityActionAffectsLighting,
  holdDashboardEventLightPolling,
  optimisticDashboardStateForEntityAction,
  publishDashboardState,
} from "../../../lib/dashboard-events";
import { parseEntityActionRequest, type EntityActionRequest } from "../../../lib/api/dashboard-requests";
import { emitDashboardEvent } from "../../../lib/event-spool";
import { emitModuleEvent, runModuleIntercepts } from "../../../lib/modules/runtime/hooks";
import { setEntityAction } from "../../../lib/ha";
import { buildDashboardState } from "../../../lib/ha";
import { handleLegacyClimateAction } from "../../../lib/climate-control";
import {
  claimLatestLightingCommand,
  INTERACTIVE_LIGHTING_COMMAND_KEY,
  isSupersededLightingCommandError,
} from "../../../lib/lighting-command-coordinator";
import type { HaDomain } from "../../../lib/types";

export const dynamic = "force-dynamic";

function traceId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isAirconRelated(action: { domain: HaDomain; entityId: string; service: string }) {
  const text = `${action.domain}.${action.service} ${action.entityId}`.toLowerCase();
  return (
    action.domain === "climate" ||
    text.includes("air") ||
    text.includes("gree") ||
    text.includes("quiet") ||
    text.includes("turbo") ||
    text.includes("xtra")
  );
}

// Bucket an entity action for the monitoring event stream so Grafana can group
// by subsystem: heating (panel heater), climate (aircon), lighting, or device.
function serviceForEntityAction(action: { domain: HaDomain; entityId: string }) {
  const id = action.entityId.toLowerCase();
  if (id.includes("heater") || id.includes("panel_heater")) {
    return "heating";
  }
  if (action.domain === "climate") {
    return "climate";
  }
  if (action.domain === "light" || action.domain === "switch") {
    return "lighting";
  }
  return "device";
}

function requestContext(request: Request, sourceClientId: number | null) {
  return {
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    sourceClientId,
    userAgent: request.headers.get("user-agent"),
    xForwardedFor: request.headers.get("x-forwarded-for"),
    xRealIp: request.headers.get("x-real-ip"),
  };
}

export async function POST(request: Request) {
  const id = traceId();
  let action: Omit<EntityActionRequest, "sourceClientId"> | null = null;
  let sourceClientId: number | null = null;

  try {
    const parsed = parseEntityActionRequest(await request.json());
    const { sourceClientId: parsedSourceClientId, ...parsedAction } = parsed;
    action = parsedAction;
    sourceClientId = parsedSourceClientId;

    if (isAirconRelated(action)) {
      console.info("[nova-dashboard] aircon entity action request", {
        action,
        request: requestContext(request, sourceClientId),
        traceId: id,
      });
    }

    // Module interceptors sit in front of the command, before the lighting
    // coordinator claim — a cancelled action must not take a claim with it.
    const intercepted = await runModuleIntercepts({
      id: "entity.action",
      source: "server",
      entity: { id: action.entityId, domain: action.domain },
      service: action.service,
      data: action.data,
    });
    if (intercepted.decision === "cancel") {
      return NextResponse.json(
        { cancelled: true, by: intercepted.moduleId },
        { status: 409 },
      );
    }

    const latestClaim = action.domain === "light" || action.domain === "switch"
      ? claimLatestLightingCommand(
          [INTERACTIVE_LIGHTING_COMMAND_KEY, `entity:${action.domain}:${action.entityId}`],
          request.signal,
        )
      : null;
    const handledByClimateController = await handleLegacyClimateAction(action);
    const state = handledByClimateController
      ? await buildDashboardState()
      : await setEntityAction({
          ...action,
          isCurrent: latestClaim?.isCurrent,
          signal: request.signal,
          traceId: id,
        });
    latestClaim?.assertCurrent();

    if (entityActionAffectsLighting(state, action)) {
      holdDashboardEventLightPolling();
      publishDashboardState(optimisticDashboardStateForEntityAction(state, action), {
        excludeClientId: sourceClientId,
        force: true,
      });
    } else {
      publishDashboardState(state, { excludeClientId: sourceClientId });
    }
    if (isAirconRelated(action)) {
      const entity = state.entities.find((candidate) => candidate.entity_id === action?.entityId);
      console.info("[nova-dashboard] aircon entity action success", {
        entity: entity
          ? {
              attributes: entity.attributes,
              entity_id: entity.entity_id,
              name: entity.name,
              state: entity.state,
            }
          : null,
        traceId: id,
      });
    }

    {
      const entity = state.entities.find((candidate) => candidate.entity_id === action?.entityId);
      emitModuleEvent({
        id: "entity.action.applied",
        at: new Date().toISOString(),
        source: "server",
        actor: sourceClientId === null ? undefined : `client:${sourceClientId}`,
        entity: {
          id: action.entityId,
          friendlyName: entity?.name,
          domain: action.domain,
          state: entity?.state,
        },
        trigger: "manual",
        data: { service: action.service, ...(action.data ?? {}) },
      });
      void emitDashboardEvent({
        service: serviceForEntityAction(action),
        event: "entity-action",
        source: "user",
        detail: {
          entity: action.entityId,
          domain: action.domain,
          service: action.service,
          state: entity?.state,
        },
      });
    }

    return NextResponse.json(state);
  } catch (error) {
    if (request.signal.aborted || isSupersededLightingCommandError(error)) {
      return NextResponse.json({ superseded: true }, { status: 202 });
    }

    if (action && isAirconRelated(action)) {
      console.error("[nova-dashboard] aircon entity action failed", {
        action,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        request: requestContext(request, sourceClientId),
        traceId: id,
      });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Entity action failed" },
      { status: 400 },
    );
  }
}
