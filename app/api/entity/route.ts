import { NextResponse } from "next/server";
import {
  entityActionAffectsLighting,
  holdDashboardEventLightPolling,
  optimisticDashboardStateForEntityAction,
  publishDashboardState,
} from "../../../lib/dashboard-events";
import { setEntityAction } from "../../../lib/ha";
import type { DashboardPreferences, HaDomain } from "../../../lib/types";

export const dynamic = "force-dynamic";

const domains = new Set(["light", "switch", "climate", "fan", "cover", "humidifier"]);

function traceId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clientId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
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
  let action:
    | {
        entityId: string;
        domain: HaDomain;
        service: string;
        data: Record<string, unknown>;
        remember?: DashboardPreferences;
      }
    | null = null;
  let sourceClientId: number | null = null;

  try {
    const body = await request.json();
    const domain = String(body.domain ?? "") as HaDomain;

    if (!domains.has(domain)) {
      throw new Error(`Unsupported domain: ${domain}`);
    }

    action = {
      entityId: String(body.entityId ?? ""),
      domain,
      service: String(body.service ?? ""),
      data: body.data ?? {},
      remember: body.remember ?? undefined,
    };
    sourceClientId = clientId(body.sourceClientId);

    if (isAirconRelated(action)) {
      console.info("[nova-dashboard] aircon entity action request", {
        action,
        request: requestContext(request, sourceClientId),
        traceId: id,
      });
    }

    const state = await setEntityAction({
      ...action,
      traceId: id,
    });

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

    return NextResponse.json(state);
  } catch (error) {
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
