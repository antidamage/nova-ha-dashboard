"use client";

import { normalizeThemeFontId } from "../../themeFonts";
import { clamp } from "./color-model";
import {
  THEME_FONT_SIZE_OFFSET_MAX,
  THEME_FONT_SIZE_OFFSET_MIN,
  THEME_FONT_WEIGHT_DEFAULT,
  THEME_FONT_WEIGHT_MAX,
  THEME_FONT_WEIGHT_MIN,
  THEME_FONT_WEIGHT_STEP,
} from "./constants";
import type { ThemeFontSetting } from "./types";

// Size offset is a percentage of the base size (-100..+100 -> 0x..2x), so +50 is 1.5x.
const THEME_FONT_SIZE_OFFSET_RATIO = 0.01;
// Floor so an extreme negative offset never collapses the text to nothing.
const THEME_FONT_SIZE_MIN_SCALE = 0.05;

/** Font-size multiplier for a size offset (-100..+100 -> 0.05x..2x), seeded as a CSS var. */
export function themeFontSizeScale(sizeOffset: number): number {
  const bounded = clamp(Math.round(Number(sizeOffset) || 0), THEME_FONT_SIZE_OFFSET_MIN, THEME_FONT_SIZE_OFFSET_MAX);
  return Number(Math.max(THEME_FONT_SIZE_MIN_SCALE, 1 + bounded * THEME_FONT_SIZE_OFFSET_RATIO).toFixed(3));
}

function normalizeFontWeight(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(Math.round(parsed / THEME_FONT_WEIGHT_STEP) * THEME_FONT_WEIGHT_STEP, THEME_FONT_WEIGHT_MIN, THEME_FONT_WEIGHT_MAX);
}

function normalizeFontSizeOffset(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return clamp(Math.round(parsed), THEME_FONT_SIZE_OFFSET_MIN, THEME_FONT_SIZE_OFFSET_MAX);
}

/** Accept a legacy id string OR a {id, weight, sizeOffset} object; return a full setting. */
export function normalizeThemeFontSetting(
  value: unknown,
  defaultId: string,
  defaultWeight: number = THEME_FONT_WEIGHT_DEFAULT,
): ThemeFontSetting {
  if (typeof value === "string") {
    return { id: normalizeThemeFontId(value, defaultId), weight: defaultWeight, sizeOffset: 0 };
  }
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  return {
    id: normalizeThemeFontId(record?.id, defaultId),
    weight: normalizeFontWeight(record?.weight, defaultWeight),
    sizeOffset: normalizeFontSizeOffset(record?.sizeOffset),
  };
}
