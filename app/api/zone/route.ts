import { NextResponse } from "next/server";
import {
  holdDashboardEventLightPolling,
  isLightZoneAction,
  optimisticDashboardStateForZoneAction,
  publishDashboardState,
  rememberSpectrumCursor,
} from "../../../lib/dashboard-events";
import { setZoneAction } from "../../../lib/ha";
import type { SpectrumCursor } from "../../../lib/types";

export const dynamic = "force-dynamic";

type ZoneAction = "on" | "off" | "brightness" | "color" | "candlelight" | "white";
const zoneActions = new Set<string>(["on", "off", "brightness", "color", "candlelight", "white"]);

function rgbTuple(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) {
    return undefined;
  }

  const rgb = value.map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))));
  if (rgb.some((part) => !Number.isFinite(part))) {
    return undefined;
  }

  return rgb as [number, number, number];
}

function spectrumCursor(value: unknown): SpectrumCursor | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const cursor = value as Record<string, unknown>;
  const x = Number(cursor.x);
  const y = Number(cursor.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }

  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

function clientId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const zoneId = String(body.zoneId ?? "everything");
    const actionName = String(body.action ?? "");
    if (!zoneActions.has(actionName)) {
      throw new Error(`Unsupported zone action: ${actionName}`);
    }
    const action = actionName as ZoneAction;
    const brightnessPct = body.brightnessPct === undefined ? undefined : Number(body.brightnessPct);
    const rgb = rgbTuple(body.rgb);
    const cursor = spectrumCursor(body.cursor);
    const sourceClientId = clientId(body.sourceClientId);
    const state = await setZoneAction({
      zoneId,
      action,
      brightnessPct,
      rgb,
    });

    rememberSpectrumCursor(zoneId, cursor);
    if (isLightZoneAction(action)) {
      holdDashboardEventLightPolling();
      publishDashboardState(
        optimisticDashboardStateForZoneAction(state, { action, brightnessPct, cursor, rgb, zoneId }),
        { excludeClientId: sourceClientId, force: true },
      );
    } else {
      publishDashboardState(state, { excludeClientId: sourceClientId });
    }
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Zone action failed" },
      { status: 400 },
    );
  }
}
