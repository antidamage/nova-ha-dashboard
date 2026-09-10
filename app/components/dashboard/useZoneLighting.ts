"use client";

import { useCallback, useMemo, useRef } from "react";
import type { DashboardZone, SpectrumCursor, SunStatus } from "../../../lib/types";
import {
  BRIGHTNESS_CONVERGENCE_TOLERANCE_PCT,
  CANDLELIGHT_SPECTRUM,
  LIGHT_REMOTE_SETTING_HOLD_MS,
  WHITE_SPECTRUM,
  adaptiveCandlelightSpectrum,
  candlelightBrightnessPct,
  spectrumFromZone,
  spectrumWithCursor,
  type SpectrumValue,
} from "./lighting";
import { useRemoteSetting } from "./useRemoteSetting";

export type ZoneActionHandler = (action: string, body?: Record<string, unknown>) => Promise<void>;

/**
 * Whether a zone's reported brightness has reached what was set. The zone value
 * is an average over its lit fixtures, so allow for per-fixture rounding of the
 * commanded percent into Home Assistant's `0..255` scale.
 */
export function brightnessPctConverged(remotePct: number, localPct: number) {
  return Math.abs(remotePct - localPct) <= BRIGHTNESS_CONVERGENCE_TOLERANCE_PCT;
}

export function spectrumValuesEqual(left: SpectrumValue, right: SpectrumValue) {
  return (
    left.cursor.x === right.cursor.x &&
    left.cursor.y === right.cursor.y &&
    left.preview[0] === right.preview[0] &&
    left.preview[1] === right.preview[1] &&
    left.preview[2] === right.preview[2]
  );
}

/**
 * A zone's displayed brightness and colour, bound to the server the way the
 * zone card binds them, plus its preset and colour commands.
 *
 * The zone actions themselves are server-side (`setZoneAction`, lib/ha.ts), so
 * per-light presets, pinned lights and the adaptive night rules apply to
 * whatever surface sends them. This hook only decides what to send and what to
 * show meanwhile.
 */
export function useZoneLighting({
  spectrumCursor,
  sun,
  zone,
  onZoneAction,
}: {
  spectrumCursor?: SpectrumCursor;
  sun?: SunStatus | null;
  zone: DashboardZone;
  onZoneAction: ZoneActionHandler;
}) {
  const spectrumByZone = useRef<Record<string, SpectrumValue>>({});
  const remoteSpectrum = useMemo(
    () => spectrumWithCursor(spectrumFromZone(zone), spectrumCursor) ?? spectrumByZone.current[zone.id] ?? CANDLELIGHT_SPECTRUM,
    [spectrumCursor?.x, spectrumCursor?.y, zone],
  );
  // While the zone is mid-transition the server publishes where it is going, so
  // the control binds to that target rather than to the averaged waypoint.
  const { setLocalValue: setLocalBrightness, value: brightness } = useRemoteSetting({
    isConverged: brightnessPctConverged,
    isTransitional: Boolean(zone.brightnessTransition),
    key: zone.id,
    remoteValue: zone.brightnessTransition?.targetPct ?? zone.brightnessPct,
  });
  const { setLocalValue: setLocalSpectrum, value: spectrum } = useRemoteSetting({
    isEqual: spectrumValuesEqual,
    key: zone.id,
    onRemoteAccept: (value) => {
      spectrumByZone.current[zone.id] = value;
    },
    remoteValue: remoteSpectrum,
    timeoutMs: LIGHT_REMOTE_SETTING_HOLD_MS,
  });

  const rememberSpectrum = useCallback(
    (value: SpectrumValue) => {
      spectrumByZone.current[zone.id] = value;
      setLocalSpectrum(value);
    },
    [setLocalSpectrum, zone.id],
  );

  const applyPreset = useCallback(
    (action: "on" | "candlelight" | "white") => {
      const nextSpectrum = action === "white" ? WHITE_SPECTRUM : adaptiveCandlelightSpectrum(sun);
      const nextBrightness = action === "white" ? 100 : candlelightBrightnessPct(sun);
      setLocalBrightness(nextBrightness);
      rememberSpectrum(nextSpectrum);
      return onZoneAction(action, { brightnessPct: nextBrightness, cursor: nextSpectrum.cursor, rgb: nextSpectrum.preview });
    },
    [onZoneAction, rememberSpectrum, setLocalBrightness, sun],
  );

  const hasLightDevices = zone.entities.some((entity) => entity.domain === "light");

  return {
    applyPreset,
    brightness,
    hasLightDevices,
    rememberSpectrum,
    setLocalBrightness,
    spectrum,
    commitBrightness: (value: number) => onZoneAction("brightness", { brightnessPct: value }),
    commitColor: (rgb: [number, number, number], brightnessPct: number, cursor: SpectrumCursor) =>
      onZoneAction("color", { rgb, brightnessPct, cursor }),
    turnOff: () => onZoneAction("off"),
  };
}
