"use client";

import { climateTargetTemperature, numericClimateAttribute } from "../../../../lib/aircon-control";
import type { DashboardEntity } from "../../../../lib/types";
import { STEP_EPSILON } from "./constants";

export function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function numberArray(value: unknown, length: number) {
  if (!Array.isArray(value) || value.length < length) {
    return null;
  }

  const numbers = value.slice(0, length).map(Number);
  return numbers.every(Number.isFinite) ? numbers : null;
}

export function roundToStep(value: number, step: number) {
  return Number((Math.round(value / step) * step).toFixed(3));
}

export function temperatureDelta(entity: DashboardEntity, delta: number, step: number, base?: number) {
  const current = base ?? climateTargetTemperature(entity) ?? 20;
  const min = numericClimateAttribute(entity, "min_temp") ?? 5;
  const max = numericClimateAttribute(entity, "max_temp") ?? 40;
  const increment = Math.abs(step) || 0.5;
  const ratio = current / increment;
  const aligned = Math.abs(ratio - Math.round(ratio)) < STEP_EPSILON;
  const stepped = aligned
    ? current + delta
    : delta > 0
      ? Math.ceil(ratio) * increment
      : Math.floor(ratio) * increment;

  return clamp(roundToStep(stepped, increment), min, max);
}

export function formatTemperature(value: number | null) {
  if (value === null) {
    return "--";
  }

  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

export function formatHumidity(value: number | null) {
  if (value === null) {
    return "--";
  }

  return Math.round(value).toString();
}

export function formatWeatherNumber(value: number | null, digits = 0) {
  if (value === null) {
    return "--";
  }

  return value.toFixed(digits);
}

/**
 * Home Assistant's condition ids run words together ("partlycloudy") or hyphenate
 * them ("clear-night"); this used to swap underscores only, so the weather panel
 * read "PARTLYCLOUDY". Every surface showing a condition calls this, so they
 * cannot disagree about the same live weather.
 */
const WEATHER_CONDITION_LABELS: Record<string, string> = {
  "clear-night": "Clear",
  exceptional: "Extreme",
  lightning: "Storm",
  "lightning-rainy": "Storm",
  partlycloudy: "Partly cloudy",
  pouring: "Heavy rain",
  "snowy-rainy": "Sleet",
};

export function weatherLabel(condition: string) {
  const text = condition.trim().toLowerCase();
  if (!text) {
    return "Unknown";
  }

  const label = WEATHER_CONDITION_LABELS[text] ?? text.replace(/[_-]+/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
