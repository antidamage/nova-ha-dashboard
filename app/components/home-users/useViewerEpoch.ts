"use client";

import { useEffect, useState } from "react";
import { HOME_USER_CHANGE_EVENT, HOME_USER_STORAGE_KEY } from "./homeUserSetting";

/**
 * A number that goes up each time this device's home user changes. A feed lists
 * it among its effect dependencies, clears what it holds, and refetches, so the
 * previous user's reminders are never drawn for the next one
 * (specs/private-reminders.md, section 4).
 */
export function useViewerEpoch(): number {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setEpoch((value) => value + 1);
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === HOME_USER_STORAGE_KEY) bump();
    };
    window.addEventListener(HOME_USER_CHANGE_EVENT, bump);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(HOME_USER_CHANGE_EVENT, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return epoch;
}