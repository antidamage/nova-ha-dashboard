// setEntityAction: one allow-listed service call against a single entity.
import type { HaDomain } from "../types";
import { mergeDashboardPreferences } from "../preferences";
import { callService } from "./client";
import {
  deferLightingForHouseParty,
  housePartyIgnoresBrightness,
  setHousePartyZonePower,
} from "../house-party-coordinator";
import { buildDashboardState } from "../state";
import { assertLatestCommandCurrent, callLightingService } from "./lighting/commands";

export async function setEntityAction(input: {

  entityId: string;
  domain: HaDomain;
  service: string;
  data?: Record<string, unknown>;
  isCurrent?: () => boolean;
  remember?: Parameters<typeof mergeDashboardPreferences>[0];
  signal?: AbortSignal;
  traceId?: string;
  housePartyBypass?: boolean;
}) {
  const allowed: Record<HaDomain, string[]> = {
    light: ["turn_on", "turn_off", "toggle"],
    switch: ["turn_on", "turn_off", "toggle"],
    climate: [
      "turn_on",
      "turn_off",
      "set_hvac_mode",
      "set_temperature",
      "set_fan_mode",
      "set_swing_mode",
    ],
    fan: ["turn_on", "turn_off", "toggle", "set_percentage"],
    cover: ["open_cover", "close_cover", "stop_cover"],
    humidifier: ["turn_on", "turn_off", "toggle", "set_humidity"],
    sensor: [],
  };

  if (!allowed[input.domain]?.includes(input.service)) {
    throw new Error(`Service ${input.domain}.${input.service} is not allowed`);
  }

  const isAirconRelated =
    input.domain === "climate" ||
    `${input.entityId} ${input.service}`.toLowerCase().match(/\b(air|gree|quiet|turbo|xtra)\b/) !== null;

  if (isAirconRelated) {
    console.info("[nova-dashboard] aircon setEntityAction start", {
      data: input.data ?? {},
      domain: input.domain,
      entityId: input.entityId,
      remember: input.remember,
      service: input.service,
      traceId: input.traceId,
    });
  }

  try {
    let serviceData = {
      entity_id: input.entityId,
      ...(input.data ?? {}),
    };
    if (input.domain === "light" && input.service === "turn_on" && !input.housePartyBypass) {
      const styleKeys = ["brightness", "brightness_pct", "color_temp", "color_temp_kelvin", "hs_color", "rgb_color", "rgbw_color", "rgbww_color", "xy_color"];
      const presentStyleKeys = styleKeys.filter((key) => key in serviceData);
      const hasStyle = presentStyleKeys.length > 0;
      const hasOnlyBrightness = presentStyleKeys.every((key) => key === "brightness" || key === "brightness_pct");
      const deferred = hasStyle && deferLightingForHouseParty(`entity:${input.entityId}`, async () => {
        await setEntityAction({
          ...input,
          housePartyBypass: true,
          isCurrent: undefined,
          signal: undefined,
        });
      });
      if (deferred && !(hasOnlyBrightness && housePartyIgnoresBrightness())) {
        serviceData = { entity_id: input.entityId };
      }
    }
    if (input.domain === "light" || input.domain === "switch") {
      await callLightingService(input.domain, input.service, serviceData, input);
    } else {
      assertLatestCommandCurrent(input);
      await callService(input.domain, input.service, serviceData, { signal: input.signal });
    }
    assertLatestCommandCurrent(input);
  } catch (error) {
    if (isAirconRelated) {
      console.error("[nova-dashboard] aircon setEntityAction service failed", {
        data: input.data ?? {},
        domain: input.domain,
        entityId: input.entityId,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        service: input.service,
        traceId: input.traceId,
      });
    }

    throw error;
  }

  if (input.remember) {
    if (isAirconRelated) {
      console.info("[nova-dashboard] aircon preference merge", {
        remember: input.remember,
        traceId: input.traceId,
      });
    }
    await mergeDashboardPreferences(input.remember);
    assertLatestCommandCurrent(input);
  }

  const nextState = await buildDashboardState();
  if (input.domain === "light" && ["turn_on", "turn_off", "toggle"].includes(input.service)) {
    const entity = nextState.entities.find((candidate) => candidate.entity_id === input.entityId);
    const on = entity?.state === "on";
    for (const zone of nextState.zones) {
      if (zone.entities.some((candidate) => candidate.entity_id === input.entityId)) {
        setHousePartyZonePower(zone.id, on);
      }
    }
  }
  assertLatestCommandCurrent(input);

  if (isAirconRelated) {
    const entity = nextState.entities.find((candidate) => candidate.entity_id === input.entityId);
    console.info("[nova-dashboard] aircon setEntityAction complete", {
      entity: entity
        ? {
            attributes: entity.attributes,
            entity_id: entity.entity_id,
            name: entity.name,
            state: entity.state,
          }
        : null,
      traceId: input.traceId,
    });
  }

  return nextState;
}
