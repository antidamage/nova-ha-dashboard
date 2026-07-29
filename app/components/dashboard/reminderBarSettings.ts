"use client";

// Presentation settings for the reminder icon bar, read from the shared client
// config (see app/api/config/client/route.ts). Same read-cache-then-refresh
// shape as ClimateControls' off-timer increment and MapPanel's map centre:
// paint immediately from localStorage, correct from the network a tick later,
// so a cold kiosk never shows a bar laid out with the wrong geometry.

import { useEffect, useState } from "react";

import {
  loadSharedClientConfig,
  readCachedClientConfig,
  SHARED_CONFIG_CHANGE_EVENT,
} from "../sharedConfigCache";

export type ReminderOutlineShape = "rounded-rect" | "circle" | "square";

export type ReminderBarSettings = {
  outlineShape: ReminderOutlineShape;
  overduePulseAfterMs: number;
  inactiveOpacity: number;
  maxTiles: number;
  undoWindowMs: number;
  undoHoldMs: number;
};

export const DEFAULT_REMINDER_BAR_SETTINGS: ReminderBarSettings = {
  outlineShape: "rounded-rect",
  overduePulseAfterMs: 86_400_000,
  inactiveOpacity: 0.5,
  maxTiles: 10,
  undoWindowMs: 600_000,
  undoHoldMs: 2_000,
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function reminderBarSettingsFromConfig(config: unknown): ReminderBarSettings {
  const reminders = record(record(record(config)?.dashboard)?.reminders);
  if (!reminders) {
    return DEFAULT_REMINDER_BAR_SETTINGS;
  }

  const shape = reminders.outlineShape;
  const opacity = reminders.inactiveOpacity;

  return {
    outlineShape:
      shape === "circle" || shape === "square" || shape === "rounded-rect"
        ? shape
        : DEFAULT_REMINDER_BAR_SETTINGS.outlineShape,
    overduePulseAfterMs: positiveNumber(
      reminders.overduePulseAfterMs,
      DEFAULT_REMINDER_BAR_SETTINGS.overduePulseAfterMs,
    ),
    inactiveOpacity:
      typeof opacity === "number" && Number.isFinite(opacity) && opacity >= 0 && opacity <= 1
        ? opacity
        : DEFAULT_REMINDER_BAR_SETTINGS.inactiveOpacity,
    maxTiles: positiveNumber(reminders.maxTiles, DEFAULT_REMINDER_BAR_SETTINGS.maxTiles),
    undoWindowMs: positiveNumber(reminders.undoWindowMs, DEFAULT_REMINDER_BAR_SETTINGS.undoWindowMs),
    undoHoldMs: positiveNumber(reminders.undoHoldMs, DEFAULT_REMINDER_BAR_SETTINGS.undoHoldMs),
  };
}

export function useReminderBarSettings(): ReminderBarSettings {
  const [settings, setSettings] = useState(DEFAULT_REMINDER_BAR_SETTINGS);

  useEffect(() => {
    setSettings(reminderBarSettingsFromConfig(readCachedClientConfig()));

    let cancelled = false;
    void loadSharedClientConfig()
      .then((config) => {
        if (!cancelled) {
          setSettings(reminderBarSettingsFromConfig(config));
        }
      })
      .catch(() => {
        // Cached/default geometry is a perfectly good bar. Nothing to say.
      });

    const onChange = () => setSettings(reminderBarSettingsFromConfig(readCachedClientConfig()));
    window.addEventListener(SHARED_CONFIG_CHANGE_EVENT, onChange);

    return () => {
      cancelled = true;
      window.removeEventListener(SHARED_CONFIG_CHANGE_EVENT, onChange);
    };
  }, []);

  return settings;
}
