"use client";

import { useCallback, useEffect, useRef } from "react";
import type { DashboardEntity, DashboardZone, SpectrumCursor, SunStatus } from "../../../lib/types";
import { clamp, numberArray } from "./shared";

export type SpectrumValue = {
  cursor: { x: number; y: number };
  preview: [number, number, number];
};

export const LIGHT_DRAG_COMMAND_INTERVAL_MS = 450;
export const LIGHT_COMMAND_POLL_HOLD_MS = 5000;
export const SPECTRUM_LOCAL_HOLD_MS = LIGHT_COMMAND_POLL_HOLD_MS;

export const CANDLELIGHT_SPECTRUM: SpectrumValue = {
  cursor: { x: 0.08, y: 0.12 },
  preview: [255, 147, 41],
};

export const WARM_WHITE_SPECTRUM: SpectrumValue = {
  cursor: { x: 0.09, y: 0.66 },
  preview: [255, 214, 170],
};

export const WHITE_SPECTRUM: SpectrumValue = {
  cursor: { x: 0.13, y: 0.96 },
  preview: [255, 255, 255],
};

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function rgbToHsl([red, green, blue]: [number, number, number]): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return [0, 0, lightness * 100];
  }

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;

  if (max === r) {
    hue = (g - b) / delta + (g < b ? 6 : 0);
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  return [hue * 60, saturation * 100, lightness * 100];
}

export function spectrumRgbAtPosition(x: number, y: number): [number, number, number] {
  const hue = Math.round(clamp(x, 0, 1) * 359);
  const boundedY = clamp(y, 0, 1);
  const saturation = Math.round((1 - boundedY) * 100);
  const lightness = Math.round(50 + boundedY * 50);

  return hslToRgb(hue, saturation, lightness);
}

export function spectrumFromHs(hue: number, saturation: number): SpectrumValue {
  const boundedHue = ((hue % 360) + 360) % 360;
  const boundedSaturation = clamp(saturation, 0, 100);
  const x = clamp(boundedHue / 359, 0, 1);
  const y = clamp(1 - boundedSaturation / 100, 0, 1);

  return {
    cursor: { x, y },
    preview: spectrumRgbAtPosition(x, y),
  };
}

export function spectrumFromRgb(rgb: [number, number, number]): SpectrumValue {
  const normalized = rgb.map((value) => clamp(Math.round(value), 0, 255)) as [number, number, number];
  const [hue, saturation] = rgbToHsl(normalized);
  const value = spectrumFromHs(hue, saturation);

  return {
    ...value,
    preview: normalized,
  };
}

export function spectrumFromKelvin(kelvin: number): SpectrumValue {
  const ratio = clamp((kelvin - 1800) / (6500 - 1800), 0, 1);
  const mix = (warm: number, cool: number) => Math.round(warm + (cool - warm) * ratio);

  return {
    cursor: {
      x: CANDLELIGHT_SPECTRUM.cursor.x + (WHITE_SPECTRUM.cursor.x - CANDLELIGHT_SPECTRUM.cursor.x) * ratio,
      y: CANDLELIGHT_SPECTRUM.cursor.y + (WHITE_SPECTRUM.cursor.y - CANDLELIGHT_SPECTRUM.cursor.y) * ratio,
    },
    preview: [
      mix(CANDLELIGHT_SPECTRUM.preview[0], WHITE_SPECTRUM.preview[0]),
      mix(CANDLELIGHT_SPECTRUM.preview[1], WHITE_SPECTRUM.preview[1]),
      mix(CANDLELIGHT_SPECTRUM.preview[2], WHITE_SPECTRUM.preview[2]),
    ],
  };
}

export function useReducedDragCommand<T>(
  send: (value: T) => void,
  intervalMs: number,
  reduce: (values: T[], lastSent: T | null) => T = (values) => values[values.length - 1] as T,
) {
  const lastSentAt = useRef(0);
  const lastSent = useRef<T | null>(null);
  const pending = useRef<T[]>([]);
  const reduceRef = useRef(reduce);
  const sendRef = useRef(send);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  useEffect(() => {
    reduceRef.current = reduce;
  }, [reduce]);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const drain = useCallback(() => {
    clearTimer();
    if (!pending.current.length) {
      return;
    }

    const next = reduceRef.current(pending.current, lastSent.current);
    pending.current = [];
    lastSentAt.current = Date.now();
    lastSent.current = next;
    sendRef.current(next);
  }, [clearTimer]);

  const flush = useCallback(() => {
    clearTimer();
    if (!pending.current.length) {
      return;
    }

    const next = pending.current[pending.current.length - 1];
    pending.current = [];
    lastSentAt.current = Date.now();
    lastSent.current = next;
    sendRef.current(next);
  }, [clearTimer]);

  const queue = useCallback(
    (value: T) => {
      pending.current.push(value);
      const remainingMs = intervalMs - (Date.now() - lastSentAt.current);

      if (remainingMs <= 0) {
        drain();
        return;
      }

      if (timer.current === null) {
        timer.current = window.setTimeout(drain, remainingMs);
      }
    },
    [drain, intervalMs],
  );

  useEffect(() => clearTimer, [clearTimer]);

  return { flush, queue };
}

export function spectrumFromEntity(entity: DashboardEntity) {
  if (entity.domain !== "light") {
    return null;
  }

  const rgb = numberArray(entity.attributes.rgb_color, 3);
  if (rgb) {
    return spectrumFromRgb(rgb as [number, number, number]);
  }

  const hs = numberArray(entity.attributes.hs_color, 2);
  if (hs) {
    return spectrumFromHs(hs[0], hs[1]);
  }

  const kelvin = Number(entity.attributes.color_temp_kelvin);
  if (Number.isFinite(kelvin) && kelvin > 0) {
    return spectrumFromKelvin(kelvin);
  }

  const mired = Number(entity.attributes.color_temp);
  if (Number.isFinite(mired) && mired > 0) {
    return spectrumFromKelvin(Math.round(1_000_000 / mired));
  }

  return null;
}

export function brightnessFromEntity(entity: DashboardEntity) {
  const brightness = Number(entity.attributes.brightness);
  if (Number.isFinite(brightness) && brightness > 0) {
    return clamp((brightness / 255) * 100, 0, 100);
  }

  return entity.state === "on" ? 100 : 0;
}

export function spectrumGroupKey(value: SpectrumValue) {
  const hueBucket = Math.round(value.cursor.x * 24);
  const saturationBucket = Math.round((1 - value.cursor.y) * 8);

  return `${hueBucket}:${saturationBucket}`;
}

export function spectrumFromZone(zone: DashboardZone) {
  const lights = zone.entities.filter((entity) => entity.domain === "light");
  const candidateLights = lights.some((entity) => entity.state === "on")
    ? lights.filter((entity) => entity.state === "on")
    : lights;

  const candidates = candidateLights.flatMap((entity) => {
    const spectrum = spectrumFromEntity(entity);
    if (!spectrum) {
      return [];
    }

    return [
      {
        spectrum,
        brightness: brightnessFromEntity(entity),
        groupKey: spectrumGroupKey(spectrum),
      },
    ];
  });

  if (!candidates.length) {
    return null;
  }

  const groups = new Map<string, { count: number; brightest: (typeof candidates)[number] }>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.groupKey);
    if (!group) {
      groups.set(candidate.groupKey, { count: 1, brightest: candidate });
      continue;
    }

    group.count += 1;
    if (candidate.brightness > group.brightest.brightness) {
      group.brightest = candidate;
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }

    return b.brightest.brightness - a.brightest.brightness;
  })[0].brightest.spectrum;
}

export function spectrumWithCursor(value: SpectrumValue | null, cursor?: SpectrumCursor) {
  if (!value || !cursor) {
    return value;
  }

  return {
    ...value,
    cursor: {
      x: clamp(cursor.x, 0, 1),
      y: clamp(cursor.y, 0, 1),
    },
  };
}

export function candlelightBrightnessPct(sun?: SunStatus | null) {
  return sun?.state === "below_horizon" ? 60 : 100;
}

export function adaptiveCandlelightSpectrum(sun?: SunStatus | null) {
  return sun?.state === "below_horizon" ? CANDLELIGHT_SPECTRUM : WARM_WHITE_SPECTRUM;
}

export function adaptiveCandlelightLabel(sun?: SunStatus | null) {
  return sun?.state === "below_horizon" ? "Candlelight" : "Warm white";
}
