"use client";

import { useCallback, useEffect, useState } from "react";

export const STATUS_ORB_INFO_STORAGE_KEY = "nova.dashboard.statusOrbInfo.v1";
export const STATUS_ORB_INFO_CHANGE_EVENT = "nova-status-orb-info-change";

export function readStatusOrbInfoSetting(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STATUS_ORB_INFO_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function writeStatusOrbInfoSetting(visible: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STATUS_ORB_INFO_STORAGE_KEY, visible ? "true" : "false");
  } catch {
    // Storage can be denied; same-page state still updates.
  }
  document.documentElement.toggleAttribute("data-nova-hide-orb-info", !visible);
  window.dispatchEvent(new CustomEvent(STATUS_ORB_INFO_CHANGE_EVENT));
}

export function useStatusOrbInfoSetting() {
  const [visible, setVisibleState] = useState(true);

  useEffect(() => {
    const sync = () => {
      const next = readStatusOrbInfoSetting();
      document.documentElement.toggleAttribute("data-nova-hide-orb-info", !next);
      setVisibleState(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === STATUS_ORB_INFO_STORAGE_KEY) sync();
    };
    sync();
    window.addEventListener(STATUS_ORB_INFO_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STATUS_ORB_INFO_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setVisible = useCallback((next: boolean) => {
    setVisibleState(next);
    writeStatusOrbInfoSetting(next);
  }, []);
  return [visible, setVisible] as const;
}
