import { NextResponse } from "next/server";
import {
  endHousePartySession,
  enqueueHousePartyFrame,
} from "../../../../../../lib/house-party-coordinator";
import {
  resolveHousePartyFrame,
  type HousePartyBrightnessMode,
  type HousePartyHueMode,
} from "../../../../../../lib/house-party";
import { applyHousePartyLightingFrame } from "../../../../../../lib/ha";
import {
  holdDashboardEventLightPolling,
  optimisticDashboardStateForHouseParty,
  publishDashboardState,
} from "../../../../../../lib/dashboard-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseFrame(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a House Party frame");
  const raw = value as Record<string, unknown>;
  const rgb = raw.peakRgb;
  if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some((part) => !Number.isFinite(Number(part)))) {
    throw new Error("peakRgb must contain three numbers");
  }
  const hueMode = raw.hueMode;
  const brightnessMode = raw.brightnessMode;
  if (!["follow", "complement"].includes(String(hueMode))) throw new Error("Invalid hueMode");
  if (!["follow", "oppose", "ignore"].includes(String(brightnessMode))) throw new Error("Invalid brightnessMode");
  const sequence = Number(raw.sequence);
  const peakBrightnessPct = Number(raw.peakBrightnessPct);
  const transitionSeconds = raw.transitionSeconds === undefined
    ? undefined
    : Number(raw.transitionSeconds);
  const cloudPeakBrightnessPct = raw.cloudPeakBrightnessPct === undefined
    ? undefined
    : Number(raw.cloudPeakBrightnessPct);
  if (
    !Number.isSafeInteger(sequence)
    || sequence < 0
    || !Number.isFinite(peakBrightnessPct)
    || (transitionSeconds !== undefined && !Number.isFinite(transitionSeconds))
    || (cloudPeakBrightnessPct !== undefined && !Number.isFinite(cloudPeakBrightnessPct))
  ) {
    throw new Error("Invalid House Party sequence or brightness");
  }
  const themeId = typeof raw.themeId === "string" ? raw.themeId.trim().slice(0, 128) : "";
  const themeVariant = raw.themeVariant;
  const colorThemeId = typeof raw.colorThemeId === "string" ? raw.colorThemeId.trim().slice(0, 128) : "";
  const rawPalette = raw.palette && typeof raw.palette === "object" && !Array.isArray(raw.palette)
    ? raw.palette as Record<string, unknown>
    : null;
  const palette = rawPalette ? Object.fromEntries(Object.entries(rawPalette).flatMap(([slot, value]) => {
    if (!/^[a-z][a-z0-9_-]{1,63}$/i.test(slot) || !Array.isArray(value) || value.length !== 3
      || value.some((part) => !Number.isFinite(Number(part)))) return [];
    return [[slot, value.map((part) => Math.max(0, Math.min(255, Math.round(Number(part))))) as [number, number, number]]];
  })) : null;
  const themeTransitionSeconds = Number(raw.themeTransitionSeconds);
  const transitionSecondsForTheme = Number.isFinite(themeTransitionSeconds)
    ? Math.max(0, Math.min(600, themeTransitionSeconds))
    : 0;
  const theme = colorThemeId && palette && Object.keys(palette).length
    ? {
      colorThemeId,
      palette,
      transitionSeconds: transitionSecondsForTheme,
    }
    : themeId && (themeVariant === "dark" || themeVariant === "light")
    ? {
      themeId,
      variant: themeVariant as "dark" | "light",
      transitionSeconds: transitionSecondsForTheme,
      }
    : null;
  const rawClock = raw.clock;
  let clock = null;
  if (rawClock && typeof rawClock === "object" && !Array.isArray(rawClock)) {
    const input = rawClock as Record<string, unknown>;
    const position = Number(input.position);
    const duration = Number(input.duration);
    const sampledAtMs = Number(input.sampledAtMs);
    if (
      Number.isFinite(position)
      && position >= 0
      && Number.isFinite(duration)
      && duration > 0
      && Number.isFinite(sampledAtMs)
      && typeof input.playing === "boolean"
    ) {
      clock = {
        trackKey: typeof input.trackKey === "string" ? input.trackKey.trim().slice(0, 128) || null : null,
        position: Math.min(duration, position),
        duration,
        playing: input.playing,
        sampledAtMs,
      };
    }
  }
  return {
    brightnessMode: brightnessMode as HousePartyBrightnessMode,
    sequence,
    theme,
    clock,
    output: resolveHousePartyFrame({
      peakRgb: rgb.map(Number) as [number, number, number],
      peakBrightnessPct,
      cloudPeakBrightnessPct,
      transitionSeconds,
      hueMode: hueMode as HousePartyHueMode,
      brightnessMode: brightnessMode as HousePartyBrightnessMode,
    }),
  };
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const frame = parseFrame(await request.json());
    const accepted = enqueueHousePartyFrame(id, frame.sequence, async (signal) => {
      const result = await applyHousePartyLightingFrame(frame.output, signal);
      let state = result.state;
      state = optimisticDashboardStateForHouseParty(state, {
        brightnessPct: frame.output.brightnessPct,
        entityIds: result.entityIds,
        rgb: frame.output.rgb,
      });
      holdDashboardEventLightPolling();
      publishDashboardState(state, { force: true });
    }, frame.theme, frame.clock, frame.brightnessMode);
    return accepted
      ? NextResponse.json({ accepted: true }, { status: 202 })
      : NextResponse.json({ error: "Unknown, expired, or stale House Party session" }, { status: 409 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid House Party frame" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return endHousePartySession(id)
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: "Unknown House Party session" }, { status: 404 });
}
