"use client";

import { useEffect, useState } from "react";
import { HOUSEHOLD_VIEW, readHomeUser, HOME_USER_CHANGE_EVENT } from "./homeUserSetting";

/**
 * Who this device is showing, for the reminder surfaces
 * (specs/private-reminders.md, section 7). `resolved` is false until the stored
 * choice has been read, so "Choose who you are" never flashes for a device that
 * simply has not been read yet. `userId` is null for the household view and for a
 * device that has not chosen.
 */
export function useViewerState(): { resolved: boolean; userId: string | null } {
  const [state, setState] = useState<{ resolved: boolean; userId: string | null }>({ resolved: false, userId: null });
  useEffect(() => {
    const sync = () => {
      const stored = readHomeUser();
      setState({ resolved: true, userId: stored && stored !== HOUSEHOLD_VIEW ? stored : null });
    };
    sync();
    window.addEventListener(HOME_USER_CHANGE_EVENT, sync);
    return () => window.removeEventListener(HOME_USER_CHANGE_EVENT, sync);
  }, []);
  return state;
}