"use client";

import { useCallback, useEffect, useState } from "react";
import { useViewerEpoch } from "../home-users/useViewerEpoch";
import { useViewerState } from "../home-users/useViewerState";

/**
 * This user's "chimes on or off" (specs/private-reminders.md, section 6), kept on
 * the server per user and read for whichever user this device is set to.
 * `chimeEnabled` is false until it has been read, so a device whose user has
 * chimes off never plays one in the gap before the answer arrives.
 */
export const REMINDER_PREFS_CHANGE_EVENT = "nova-reminder-prefs-change";

export function useChimePreference() {
  const { userId } = useViewerState();
  const epoch = useViewerEpoch();
  const [read, setRead] = useState<{ epoch: number; userId: string | null; chime: boolean } | null>(null);
  // A value read for the previous user is never applied to the next one.
  const chime = read && read.epoch === epoch && read.userId === userId ? read.chime : null;

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/reminders/prefs", { cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<{ chime?: boolean }>) : null))
        .then((body) => {
          if (alive) setRead({ epoch, userId, chime: body ? body.chime !== false : true });
        })
        .catch(() => {
          if (alive) setRead({ epoch, userId, chime: true });
        });
    };
    load();
    window.addEventListener(REMINDER_PREFS_CHANGE_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(REMINDER_PREFS_CHANGE_EVENT, load);
    };
  }, [epoch, userId]);

  const update = useCallback(async (next: boolean) => {
    setRead({ epoch, userId, chime: next });
    try {
      const response = await fetch("/api/reminders/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chime: next }),
      });
      if (!response.ok) throw new Error("save failed");
      window.dispatchEvent(new CustomEvent(REMINDER_PREFS_CHANGE_EVENT));
    } catch {
      window.dispatchEvent(new CustomEvent(REMINDER_PREFS_CHANGE_EVENT));
    }
  }, [epoch, userId]);

  return { chime, chimeEnabled: chime === true, canSet: userId !== null, update };
}