"use client";

import type { ControlModule, ControlSlotSurface, ControlsConfig, ResolvedSlot } from "../../../../lib/control-modules/types";
import type {
  BedroomHeaterPreferences,
  AirconPreferences,
  ClimateControlRoomState,
  DashboardState,
  DashboardZone,
  SpectrumCursor,
} from "../../../../lib/types";
import { resolveFeatures } from "../../../../lib/control-modules/features";
import { resolvedSurface } from "../../../../lib/control-modules/slots";
import { airconPreferencesFor, heaterPreferencesFor } from "../../../../lib/climate-preferences";
import { airconDevices, heaterDevices, zoneById } from "./quickSlotDevices";
import type { QuickAirconDevices, QuickHeaterDevices } from "./quickSlotDevices";

/** The features a placed preset actually has; see lib/control-modules/features.ts. */
function resolveFeaturesOf(resolved: ResolvedSlot): Record<string, boolean> {
  return resolveFeatures(resolved.module, resolved.preset);
}

/**
 * The items a dashboard PANEL shows, built from configuration
 * (specs/control-modules.md) — Quick Access first, and every other panel since
 * (Adeline, 2026-09-25). It keeps its Quick Access name and its place in this
 * directory because the module's first surface was the card and the paths that
 * serve it are the ones the reviewers and the suite know; the SURFACE it is
 * asked for is a parameter.
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

/**
 * A panel's own content, placed as a module (Adeline, 2026-09-25). It carries
 * no device and no settings: what it draws is the content the panel hands over,
 * and its whole job is to be something placeable so that content can be
 * reassigned, moved or taken off without losing it.
 */
export type QuickPanelItem = {
  key: string;
  kind: "panel";
  presetId: string;
  title: string;
};

export type QuickOutsideItem = {
  key: string;
  kind: "outside";
  presetId: string;
  title: string;
  features: Record<string, boolean>;
};

export type QuickItem = QuickAmplifierItem | QuickLightingItem | QuickClimateItem | QuickOutsideItem | QuickPanelItem;

export type QuickSlotInput = {
  /** Which panel's slots to build: it decides which placements are read. */
  surface: ControlSlotSurface;
  /**
   * The room a slot inherits when neither the preset nor the slot names one
   * (Adeline, 2026-09-25). A panel is a place, and a panel that is a room's own
   * controls passes that room; the others pass the Home zone, exactly as the card
   * does. Without it a lighting preset left on "inherit" resolved to no room at
   * all, was dropped, and drew nothing while the Devices tab listed it as placed
   * (found by the independent review of PR #51).
   */
  roomId?: string | null;
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
  inheritedRoomId: string | null,
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
    roomId: resolved.roomId ?? inheritedRoomId,
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

function lightingItem(resolved: ResolvedSlot, data: DashboardState | null, inheritedRoomId: string | null): QuickLightingItem | null {
  const zone = zoneById(data, resolved.roomId ?? inheritedRoomId);
  if (!zone) {
    return null;
  }
  return {
    features: resolveFeaturesOf(resolved),
    key: resolved.slot.id,
    kind: "lighting",
    presetId: resolved.preset.id,
    roomId: resolved.roomId ?? inheritedRoomId,
    spectrumCursor: data?.spectrumCursors?.[zone.id],
    title: resolved.preset.name,
    zone,
  };
}

/** Every slot on a panel, resolved, in order, unusable ones dropped. */
export function buildSlotItems(input: QuickSlotInput): QuickItem[] {
  const items: QuickItem[] = [];
  for (const resolved of resolvedSurface(input.controls, input.surface, input.controlModules)) {
    if (resolved.module.renderer === "panel-content") {
      items.push({
        key: resolved.slot.id,
        kind: "panel",
        presetId: resolved.preset.id,
        title: resolved.preset.name,
      });
      continue;
    }
    if (resolved.module.renderer === "lighting-dial") {
      const item = lightingItem(resolved, input.data, input.roomId ?? null);
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
        input.roomId ?? null,
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
