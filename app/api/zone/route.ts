import { NextResponse } from "next/server";
import {
  holdDashboardEventLightPolling,
  isLightZoneAction,
  optimisticDashboardStateForZoneAction,
  publishDashboardState,
  rememberSpectrumCursor,
} from "../../../lib/dashboard-events";
import { parseZoneActionRequest } from "../../../lib/api/dashboard-requests";
import { emitDashboardEvent } from "../../../lib/event-spool";
import { emitModuleEvent, runModuleIntercepts } from "../../../lib/modules/runtime/hooks";
import { setZoneAction } from "../../../lib/ha";
import {
  claimLatestLightingCommand,
  INTERACTIVE_LIGHTING_COMMAND_KEY,
  isSupersededLightingCommandError,
} from "../../../lib/lighting-command-coordinator";

export const dynamic = "force-dynamic";

function traceId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: Request) {
  const id = traceId();

  try {
    const { action, brightnessPct, cursor, rgb, sourceClientId, zoneId } = parseZoneActionRequest(await request.json());
    const intercepted = await runModuleIntercepts({
      id: "zone.action",
      source: "server",
      zone: { id: zoneId },
      service: action,
      data: { brightnessPct, rgb },
    });
    if (intercepted.decision === "cancel") {
      return NextResponse.json({ cancelled: true, by: intercepted.moduleId }, { status: 409 });
    }

    const latestClaim = isLightZoneAction(action)
      ? claimLatestLightingCommand([INTERACTIVE_LIGHTING_COMMAND_KEY, `zone:${zoneId}`], request.signal)
      : null;
    const state = await setZoneAction({
      zoneId,
      action,
      brightnessPct,
      isCurrent: latestClaim?.isCurrent,
      rgb,
      signal: request.signal,
      traceId: id,
    });
    latestClaim?.assertCurrent();

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
    emitModuleEvent({
      id: "zone.action.applied",
      at: new Date().toISOString(),
      source: "server",
      actor: sourceClientId === null ? undefined : `client:${sourceClientId}`,
      zone: { id: zoneId, name: state.zones.find((zone) => zone.id === zoneId)?.name },
      trigger: "manual",
      reason: action,
      data: { action, brightnessPct, rgb },
    });
    void emitDashboardEvent({
      service: "lighting",
      event: "zone-action",
      source: "user",
      detail: { zone: zoneId, action, brightnessPct },
    });
    return NextResponse.json(state);
  } catch (error) {
    if (request.signal.aborted || isSupersededLightingCommandError(error)) {
      return NextResponse.json({ superseded: true }, { status: 202 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Zone action failed" },
      { status: 400 },
    );
  }
}
