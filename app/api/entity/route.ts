import { NextResponse } from "next/server";
import {
  entityActionAffectsLighting,
  holdDashboardEventLightPolling,
  optimisticDashboardStateForEntityAction,
  publishDashboardState,
} from "../../../lib/dashboard-events";
import { setEntityAction } from "../../../lib/ha";
import type { HaDomain } from "../../../lib/types";

export const dynamic = "force-dynamic";

const domains = new Set(["light", "switch", "climate", "fan", "cover", "humidifier"]);

function clientId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const domain = String(body.domain ?? "") as HaDomain;

    if (!domains.has(domain)) {
      throw new Error(`Unsupported domain: ${domain}`);
    }

    const action = {
      entityId: String(body.entityId ?? ""),
      domain,
      service: String(body.service ?? ""),
      data: body.data ?? {},
      remember: body.remember ?? undefined,
    };
    const sourceClientId = clientId(body.sourceClientId);
    const state = await setEntityAction({
      ...action,
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
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Entity action failed" },
      { status: 400 },
    );
  }
}
