"use client";

// Per-device switch for the reminder BANNERS: the fixed bar across the bottom
// and the full-screen pop-over alarm. Same storage model as the other
// "This Device" settings (statusOrbInfoSetting, autoFullscreenSetting) —
// whether a screen shouts at the room is a property of that screen, not of the
// household, so a wall panel and a bedside tablet can disagree.
//
// Defaults OFF. The reminder icon bar is the ambient surface now; the banners
// are the loud opt-in on top of it.
//
// The audio cadence follows this flag: with banners on, the reminder sound
// repeats until the alert clears; with them off it plays exactly once, when the
// reminder becomes active. See TasksPanel's startAudioCadence.

import { useCallback, useEffect, useState } from "react";

export const REMINDER_BANNER_STORAGE_KEY = "nova.dashboard.reminderBanner.v1";
export const REMINDER_BANNER_CHANGE_EVENT = "nova-reminder-banner-change";

export function readReminderBannerSetting(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Opt-in: anything other than an explicit "true" means off, so an absent
    // key (a screen that has never been configured) stays quiet.
    return window.localStorage.getItem(REMINDER_BANNER_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeReminderBannerSetting(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REMINDER_BANNER_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Storage can be denied; same-page state still updates.
  }
  window.dispatchEvent(new CustomEvent(REMINDER_BANNER_CHANGE_EVENT));
}

export function useReminderBannerSetting() {
  // Starts false on both server and first client render so hydration matches;
  // the effect below corrects it before paint-relevant work happens.
  const [enabled, setEnabledState] = useState(false);

  useEffect(() => {
    const sync = () => setEnabledState(readReminderBannerSetting());
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === REMINDER_BANNER_STORAGE_KEY) sync();
    };
    sync();
    window.addEventListener(REMINDER_BANNER_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(REMINDER_BANNER_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    writeReminderBannerSetting(next);
  }, []);

  return [enabled, setEnabled] as const;
}
