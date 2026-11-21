"use client";

import { useEffect, useState } from "react";
import { clearExperienceModeSetting } from "../dashboard/experienceModeSetting";
import { setViewerCookie } from "./viewerCookie";

/**
 * Which home user this device is showing (specs/home-users.md section 3). A
 * per-device view preference, not authentication: localStorage only, never
 * written to the server, and only ever written by a tap.
 *
 * `"household"` is the everyone view. Anything else is a person id; one that no
 * longer names a home user reads as undecided, which is the caller's check.
 */

export const HOME_USER_STORAGE_KEY = "nova.dashboard.homeUser.v1";
export const HOME_USER_CHANGE_EVENT = "nova-home-user-change";
export const HOUSEHOLD_VIEW = "household";

export function readHomeUser(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(HOME_USER_STORAGE_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

function announce() {
  window.dispatchEvent(new CustomEvent(HOME_USER_CHANGE_EVENT));
}

export function writeHomeUser(id: string) {
  // The cookie first: another tab reacts to the storage write below, and its next request must carry it.
  setViewerCookie(id);
  try {
    window.localStorage.setItem(HOME_USER_STORAGE_KEY, id);
  } catch {
    // Storage denied: the in-page state still updates through the event.
  }
  announce();
}

/** Log out: forget the identity and the experience choice, so both are asked again. */
export function logOutHomeUser() {
  setViewerCookie(null);
  try {
    window.localStorage.removeItem(HOME_USER_STORAGE_KEY);
  } catch {
    // Nothing stored to clear.
  }
  clearExperienceModeSetting();
  setHomeUserGateSettled(false);
  announce();
}

export function useHomeUser(): string | null {
  // Null on the server and the first render, read in an effect: hydration-safe.
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setId(readHomeUser());
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === HOME_USER_STORAGE_KEY) sync();
    };
    sync();
    window.addEventListener(HOME_USER_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(HOME_USER_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return id;
}

/*
 * The gate the experience chooser waits on: settled once this device has an
 * identity, or once the identity chooser has found there is nobody to choose
 * (or could not find out). That keeps the two dialogs in order, identity first,
 * and a reload between them resumes at the experience step.
 */
const GATE_EVENT = "nova-home-user-gate";
let gateSettled = false;

export function setHomeUserGateSettled(settled: boolean) {
  gateSettled = settled;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(GATE_EVENT));
}

export function useHomeUserGateSettled(): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const sync = () => setSettled(gateSettled);
    sync();
    window.addEventListener(GATE_EVENT, sync);
    return () => window.removeEventListener(GATE_EVENT, sync);
  }, []);
  return settled;
}
