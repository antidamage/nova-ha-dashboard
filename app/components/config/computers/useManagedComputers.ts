"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyManagedDesktopWallpapers,
  loadManagedComputers,
  saveManagedComputers,
  type ManagedComputerFormValue,
} from "../../managed-computers-client";

// The panel's whole state machine: the in-flight-save version counters that let
// edits autosave without a save button, and the wallpaper apply action.
export function useManagedComputers() {
  const [computers, setComputers] = useState<ManagedComputerFormValue[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const computersRef = useRef<ManagedComputerFormValue[]>([]);
  const requestedSaveRef = useRef(0);
  const completedSaveRef = useRef(0);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const loaded = await loadManagedComputers();
      computersRef.current = loaded;
      setComputers(loaded);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load managed computers");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replaceComputers = (next: ManagedComputerFormValue[]) => {
    computersRef.current = next;
    setComputers(next);
  };

  const update = (index: number, updater: (computer: ManagedComputerFormValue) => ManagedComputerFormValue) => {
    replaceComputers(computersRef.current.map((computer, currentIndex) => currentIndex === index ? updater(computer) : computer));
  };

  const flushSaves = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      while (completedSaveRef.current < requestedSaveRef.current) {
        const version = requestedSaveRef.current;
        const snapshot = computersRef.current;
        // No "saving"/"saved" banner — edits autosave, and the status line
        // reflowing the panel drags the scroll position with it.
        setMessage(null);
        try {
          const saved = await saveManagedComputers(snapshot);
          completedSaveRef.current = version;
          if (version === requestedSaveRef.current) {
            replaceComputers(saved);
          }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Failed to save managed computers");
          break;
        }
      }
    } finally {
      savingRef.current = false;
    }
  };

  const persist = () => {
    requestedSaveRef.current += 1;
    void flushSaves();
  };

  const updateAndPersist = (index: number, updater: (computer: ManagedComputerFormValue) => ManagedComputerFormValue) => {
    update(index, updater);
    persist();
  };

  const applyNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const results = await applyManagedDesktopWallpapers();
      const failed = results.filter((result) => !result.ok);
      setMessage(failed.length ? failed.map((result) => `${result.name}: ${result.error}`).join(" / ") : "Desktop wallpapers applied");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to apply desktop wallpapers");
    } finally {
      setBusy(false);
    }
  };

  return { applyNow, busy, computers, computersRef, message, persist, replaceComputers, update, updateAndPersist };
}
