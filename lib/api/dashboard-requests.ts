import { z } from "zod";
import { normalizeGymAlertThresholdHours, normalizeWatchfaceIdleTimeoutMs } from "../watchface-preferences";
import type { DashboardPreferences, HaDomain, SpectrumCursor } from "../types";

export const DashboardRequestBodySchema = z.record(z.string(), z.unknown()).catch({});

const entityActionDomains = new Set(["light", "switch", "climate", "fan", "cover", "humidifier"]);
const zoneActions = new Set(["on", "off", "brightness", "color", "candlelight", "white"]);

export type EntityActionRequest = {
  entityId: string;
  domain: HaDomain;
  service: string;
  data: Record<string, unknown>;
  remember?: DashboardPreferences;
  sourceClientId: number | null;
};

export type ZoneActionRequest = {
  zoneId: string;
  action: "on" | "off" | "brightness" | "color" | "candlelight" | "white";
  brightnessPct?: number;
  rgb?: [number, number, number];
  cursor?: SpectrumCursor;
  sourceClientId: number | null;
};

function requestRecord(value: unknown) {
  return DashboardRequestBodySchema.parse(value);
}

export function clientIdFrom(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function rgbTupleFrom(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) {
    return undefined;
  }

  const rgb = value.map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))));
  if (rgb.some((part) => !Number.isFinite(part))) {
    return undefined;
  }

  return rgb as [number, number, number];
}

export function spectrumCursorFrom(value: unknown): SpectrumCursor | undefined {
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

export function parseEntityActionRequest(value: unknown): EntityActionRequest {
  const body = requestRecord(value);
  const domain = String(body.domain ?? "") as HaDomain;

  if (!entityActionDomains.has(domain)) {
    throw new Error(`Unsupported domain: ${domain}`);
  }

  return {
    entityId: String(body.entityId ?? ""),
    domain,
    service: String(body.service ?? ""),
    data: (body.data ?? {}) as Record<string, unknown>,
    remember: body.remember as DashboardPreferences | undefined,
    sourceClientId: clientIdFrom(body.sourceClientId),
  };
}

export function parseZoneActionRequest(value: unknown): ZoneActionRequest {
  const body = requestRecord(value);
  const actionName = String(body.action ?? "");

  if (!zoneActions.has(actionName)) {
    throw new Error(`Unsupported zone action: ${actionName}`);
  }

  return {
    zoneId: String(body.zoneId ?? "everything"),
    action: actionName as ZoneActionRequest["action"],
    brightnessPct: body.brightnessPct === undefined ? undefined : Number(body.brightnessPct),
    rgb: rgbTupleFrom(body.rgb),
    cursor: spectrumCursorFrom(body.cursor),
    sourceClientId: clientIdFrom(body.sourceClientId),
  };
}

export function parseDesktopSleepRequest(value: unknown) {
  const body = requestRecord(value);
  const id = String(body.id ?? "").trim();
  if (!id) {
    throw new Error("Desktop target id is required");
  }

  return {
    id,
    sourceClientId: clientIdFrom(body.sourceClientId),
  };
}

export function parseDesktopWakeRequest(value: unknown) {
  const body = requestRecord(value);
  const id = String(body.id ?? "").trim();
  if (!id) {
    throw new Error("Desktop target id is required");
  }

  return {
    id,
    sourceClientId: clientIdFrom(body.sourceClientId),
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function sharedThemeValue(value: unknown) {
  const theme = recordValue(value);
  if (!theme) {
    return null;
  }

  const {
    autoFullscreenOnLoad: _localOnly,
    followVisualizerWhenActive: _sharedConfigOnly,
    ...sharedTheme
  } = theme;
  const themes = recordValue(sharedTheme.themes);
  if (themes) {
    sharedTheme.themes = Object.fromEntries(
      Object.entries(themes).map(([variant, themeValue]) => [
        variant,
        sharedThemeValue(themeValue) ?? themeValue,
      ]),
    );
  }

  return sharedTheme;
}

export function parseThemeUpdateRequest(value: unknown) {
  const body = requestRecord(value);
  const theme = sharedThemeValue(body.theme);

  if (!theme) {
    throw new Error("Shared theme must be an object");
  }

  return { theme };
}

export function parseThemeLibraryUpdateRequest(value: unknown) {
  const body = requestRecord(value);
  const library = recordValue(body.library);

  if (!library) {
    throw new Error("Theme library must be an object");
  }

  return { library };
}

export function parseVoicePersonalityLibraryUpdateRequest(value: unknown) {
  const body = requestRecord(value);
  const library = recordValue(body.library);

  if (!library) {
    throw new Error("Voice personality library must be an object");
  }

  return { library };
}

export function parseAirconTimerUpdateRequest(value: unknown) {
  const body = requestRecord(value);
  const offTimerEndsAt = body.offTimerEndsAt;

  if (offTimerEndsAt === null) {
    return { offTimerEndsAt: null };
  }

  const normalized = isoTimestampFrom(offTimerEndsAt);
  if (!normalized) {
    throw new Error("Timer end time must be a valid ISO timestamp or null");
  }

  return { offTimerEndsAt: normalized };
}

export function isoTimestampFrom(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

export function parseWatchfaceUpdateRequest(value: unknown) {
  const body = requestRecord(value);
  const next = {
    gymAlertThresholdHours: body.gymAlertThresholdHours === undefined
      ? undefined
      : normalizeGymAlertThresholdHours(body.gymAlertThresholdHours),
    gymLastResetAt: isoTimestampFrom(body.gymLastResetAt),
    idleTimeoutMs: body.idleTimeoutMs === undefined
      ? undefined
      : normalizeWatchfaceIdleTimeoutMs(body.idleTimeoutMs),
  };

  if (next.gymAlertThresholdHours === undefined && next.gymLastResetAt === undefined && next.idleTimeoutMs === undefined) {
    throw new Error("No watchface settings provided");
  }

  return next;
}
