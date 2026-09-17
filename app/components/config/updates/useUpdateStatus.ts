"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingCooldown } from "../../useSettingCooldown";
import { POLL_INTERVAL_MS, shortSha } from "./update-model";
import type { UpdateStatus } from "./types";

// Everything the Updates section does over the wire: the 30s status poll, the
// check/apply/rollback calls and the two optimistic setting toggles. The panel
// itself is presentation only.
export function useUpdateStatus(initialAutoUpdate?: boolean) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [autoUpdate, setAutoUpdate] = useState<boolean>(initialAutoUpdate ?? true);
  const [showUpdatesOnHome, setShowUpdatesOnHome] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [applying, setApplying] = useState(false);
  const timerRef = useRef<number | null>(null);
  // Guard the Auto-Update toggle from being reverted by the 30s poll for a few
  // seconds after the user flips it (same rubber-band guard as the sliders).
  const { isCoolingDown, markInteraction } = useSettingCooldown();

  const applyStatus = useCallback((next: UpdateStatus) => {
    setStatus(next);
    setAutoUpdate(next.autoUpdate);
    setShowUpdatesOnHome(next.showUpdatesOnHome);
  }, []);

  const load = useCallback(async () => {
    if (isCoolingDown()) {
      return;
    }
    try {
      const response = await fetch("/api/update", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      if (!isCoolingDown()) {
        applyStatus((await response.json()) as UpdateStatus);
      }
    } catch {
      // endpoint absent or offline — leave last known state.
    }
  }, [applyStatus, isCoolingDown]);

  useEffect(() => {
    void load();
    timerRef.current = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
    };
  }, [load]);

  const checkForUpdates = useCallback(async () => {
    setChecking(true);
    setMessage(null);
    try {
      const response = await fetch("/api/update/check", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as UpdateStatus | { error?: string } | null;
      if (payload && "channel" in payload) {
        applyStatus(payload);
        setMessage(
          payload.updateAvailable
            ? `Update available: ${shortSha(payload.latestShortSha)}.`
            : payload.checkOk
              ? "Up to date."
              : payload.checkError ?? "Check failed.",
        );
      } else {
        setMessage(payload?.error ?? "Check failed.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Check failed.");
    } finally {
      setChecking(false);
    }
  }, [applyStatus]);

  const applyUpdate = useCallback(async () => {
    setApplying(true);
    setMessage(null);
    try {
      const response = await fetch("/api/update/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: "config" }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { status?: UpdateStatus; error?: string }
        | null;
      if (payload?.status) {
        applyStatus(payload.status);
      }
      setMessage(
        response.ok
          ? "Update queued — building the new version…"
          : payload?.error ?? "Could not start the update.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start the update.");
    } finally {
      setApplying(false);
    }
  }, [applyStatus]);

  const reinstallPrevious = useCallback(async () => {
    setRollingBack(true);
    setMessage(null);
    try {
      const response = await fetch("/api/update/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: "config" }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { status?: UpdateStatus; error?: string }
        | null;
      if (payload?.status) {
        applyStatus(payload.status);
      }
      setMessage(
        response.ok
          ? "Rolling back to the previous version…"
          : payload?.error ?? "Rollback failed.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rollback failed.");
    } finally {
      setRollingBack(false);
    }
  }, [applyStatus]);

  const toggleAutoUpdate = useCallback(async () => {
    markInteraction();
    const next = !autoUpdate;
    setAutoUpdate(next); // optimistic
    try {
      const response = await fetch("/api/update/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoUpdate: next }),
      });
      if (response.ok) {
        applyStatus((await response.json()) as UpdateStatus);
      } else {
        setAutoUpdate(!next); // revert on failure
      }
    } catch {
      setAutoUpdate(!next);
    }
  }, [autoUpdate, applyStatus, markInteraction]);

  const toggleShowUpdatesOnHome = useCallback(async () => {
    markInteraction();
    const next = !showUpdatesOnHome;
    setShowUpdatesOnHome(next); // optimistic
    try {
      const response = await fetch("/api/update/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showUpdatesOnHome: next }),
      });
      if (response.ok) {
        applyStatus((await response.json()) as UpdateStatus);
      } else {
        setShowUpdatesOnHome(!next); // revert on failure
      }
    } catch {
      setShowUpdatesOnHome(!next);
    }
  }, [showUpdatesOnHome, applyStatus, markInteraction]);

  const busy = status?.busy ?? false;
  const updateAvailable = status?.updateAvailable ?? false;

  return {
    applyUpdate,
    applying,
    autoUpdate,
    busy,
    checkForUpdates,
    checking,
    message,
    reinstallPrevious,
    rollingBack,
    showUpdatesOnHome,
    status,
    toggleAutoUpdate,
    toggleShowUpdatesOnHome,
    updateAvailable,
  };
}
