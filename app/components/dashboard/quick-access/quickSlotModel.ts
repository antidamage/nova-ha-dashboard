"use client";

import type { ControlModule, ControlsConfig, ResolvedSlot } from "../../../../lib/control-modules/types";
import type {
  BedroomHeaterPreferences,
  AirconPreferences,
  ClimateControlRoomState,
  DashboardState,
  DashboardZone,
  SpectrumCursor,
} from "../../../../lib/types";
import { resolveFeatures } from "../../../../lib/control-modules/features";
import { quickAccessSlots } from "../../../../lib/control-modules/slots";
import { airconPreferencesFor, heaterPreferencesFor } from "../../../../lib/climate-preferences";
import { airconDevices, heaterDevices, zoneById } from "./quickSlotDevices";
import type { QuickAirconDevices, QuickHeaterDevices } from "./quickSlotDevices";

/** The features a placed preset actually has; see lib/control-modules/features.ts. */
function resolveFeaturesOf(resolved: ResolvedSlot): Record<string, boolean> {
  return resolveFeatures(resolved.module, resolved.preset);
}

/**
 * The Quick Access card, built from configuration (specs/control-modules.md).
 *
 * One slot in, one renderable item out. The DEVICE half — which entity is the
 * aircon, which switch is Fresh air, whether the room's sensor list is even read
 * — lives in `quickSlotDevices.ts`, so this file is the item model and the
 * renderer choice and nothing else.
 *
 * The items come out in the order the slots are configured in, which is the
 * order they take in the card's grid (Adeline, 2026-09-25). A module's declared
 * `region` no longer places it: the card is a grid of equal slots, not a stack of
 * lines, so the 1x4/4x1/2x2 arrangement and the position in it are the slot's
 * order and the room the panel has.
 *
 * Device resolution order, and why: an explicit id in the preset's binding wins,
 * then the room the preset serves, and only then the zone the installation files
 * its climate devices under. A home that has bound nothing behaves exactly as it
 * did before presets existed, which is what makes the derived defaults
 * indistinguishable from the hard-coded card they replaced.
 */

export type QuickAmplifierItem = {
  key: string;
  kind: "amplifier";
  presetId: string;
  title: string;
};

export type QuickLightingItem = {
  key: string;
  kind: "lighting";
  presetId: string;
  title: string;
  roomId: string | null;
  features: Record<string, boolean>;
  zone: DashboardZone;
  /** The room's remembered colour, so a placed dial agrees with its own card. */
  spectrumCursor?: SpectrumCursor;
};

type QuickClimateCommon = {
  key: string;
  kind: "climate";
  presetId: string;
  title: string;
  roomId: string | null;
  features: Record<string, boolean>;
  driverId: string | null;
  climateControl?: ClimateControlRoomState;
  preferredRange?: { min: number; max: number };
};

/**
 * A climate slot is one of the two things the module can be, and which one is
 * on the item rather than on the renderer: the segment a slot draws and the
 * devices it has are decided together, so the pair can never disagree.
 */
export type QuickAirconItem = QuickClimateCommon & {
  variant: "aircon";
  preferences?: AirconPreferences;
  aircon: QuickAirconDevices;
};

export type QuickHeaterItem = QuickClimateCommon & {
  variant: "heater";
  preferences?: BedroomHeaterPreferences;
  heater: QuickHeaterDevices;
};

export type QuickClimateItem = QuickAirconItem | QuickHeaterItem;

export type QuickOutsideItem = {
  key: string;
  kind: "outside";
  presetId: string;
  title: string;
  features: Record<string, boolean>;
};

export type QuickItem = QuickAmplifierItem | QuickLightingItem | QuickClimateItem | QuickOutsideItem;

export type QuickSlotInput = {
  controls: ControlsConfig;
  /** The registry the slots are resolved against: shipped plus installed. */
  controlModules: readonly ControlModule[];
  data: DashboardState | null;
  /** The zone the installation files its climate devices under. */
  climateZone?: DashboardZone | null;
  preferences?: DashboardState["preferences"];
};

function climateItem(
  resolved: ResolvedSlot,
  data: DashboardState | null,
  climateZone: DashboardZone | null | undefined,
  preferences: DashboardState["preferences"] | undefined,
  preferredRange: { min: number; max: number } | undefined,
): QuickClimateItem | null {
  const variant: "aircon" | "heater" = resolved.preset.variant === "heater" ? "heater" : "aircon";
  const features = resolveFeaturesOf(resolved);
  const common = {
    climateControl: data?.climateControl?.[resolved.preset.id],
    driverId: resolved.driver?.id ?? null,
    features,
    key: resolved.slot.id,
    kind: "climate" as const,
    preferredRange,
    presetId: resolved.preset.id,
    roomId: resolved.roomId,
    title: resolved.preset.name,
  };
  if (variant === "heater") {
    const heater = heaterDevices(resolved.preset, data, climateZone, features);
    if (!heater) {
      return null;
    }
    return { ...common, heater, preferences: heaterPreferencesFor(preferences, resolved.preset.id), variant };
  }
  const aircon = airconDevices(resolved.preset, data, climateZone);
  if (!aircon) {
    return null;
  }
  return { ...common, aircon, preferences: airconPreferencesFor(preferences, resolved.preset.id), variant };
}

function lightingItem(resolved: ResolvedSlot, data: DashboardState | null): QuickLightingItem | null {
  const zone = zoneById(data, resolved.roomId);
  if (!zone) {
    return null;
  }
  return {
    features: resolveFeaturesOf(resolved),
    key: resolved.slot.id,
    kind: "lighting",
    presetId: resolved.preset.id,
    roomId: resolved.roomId,
    spectrumCursor: data?.spectrumCursors?.[zone.id],
    title: resolved.preset.name,
    zone,
  };
}

/** Every slot on the Quick Access card, resolved, in order, unusable ones dropped. */
export function buildQuickAccessItems(input: QuickSlotInput): QuickItem[] {
  const items: QuickItem[] = [];
  for (const resolved of quickAccessSlots(input.controls, input.controlModules)) {
    if (resolved.module.renderer === "lighting-dial") {
      const item = lightingItem(resolved, input.data);
      if (item) {
        items.push(item);
      }
      continue;
    }
    if (resolved.module.renderer === "climate-knob") {
      const item = climateItem(
        resolved,
        input.data,
        input.climateZone,
        input.preferences,
        input.preferences?.climateTargetRange,
      );
      if (item) {
        items.push(item);
      }
      continue;
    }
    if (resolved.module.renderer === "amplifier-dial") {
      items.push({
        key: resolved.slot.id,
        kind: "amplifier",
        presetId: resolved.preset.id,
        title: resolved.preset.name,
      });
      continue;
    }
    if (resolved.module.renderer === "weather-readings") {
      items.push({
        features: resolveFeaturesOf(resolved),
        key: resolved.slot.id,
        kind: "outside",
        presetId: resolved.preset.id,
        title: resolved.preset.name,
      });
    }
  }
  return items;
}
