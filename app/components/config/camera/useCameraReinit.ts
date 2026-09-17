"use client";

import { useCallback, useEffect, useState } from "react";
import { cameraUrl } from "../../dashboard/cameraHost";

// The two-stage confirm and the USB re-initialise request behind it.
export function useCameraReinit(videoHostUrl: string) {
  // Double-confirm modal for the destructive re-init (like System Power).
  const [confirmStage, setConfirmStage] = useState<0 | 1 | 2>(0);
  const [reinitBusy, setReinitBusy] = useState(false);
  const [reinitMessage, setReinitMessage] = useState<string | null>(null);

  const closeConfirm = useCallback(() => {
    if (!reinitBusy) setConfirmStage(0);
  }, [reinitBusy]);

  useEffect(() => {
    if (confirmStage === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmStage, closeConfirm]);

  const fireReinit = useCallback(async () => {
    setReinitBusy(true);
    setReinitMessage(null);
    try {
      const response = await fetch(cameraUrl("outside", "reinitialize", videoHostUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: "config" }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setConfirmStage(0);
      setReinitMessage(
        response.ok
          ? "Camera re-initialising — the encoder restarted now; a full USB reset was queued on the host and completes within a minute."
          : payload?.error ?? "The re-initialise request could not be sent.",
      );
    } catch (error) {
      setConfirmStage(0);
      setReinitMessage(error instanceof Error ? error.message : "The re-initialise request could not be sent.");
    } finally {
      setReinitBusy(false);
    }
  }, [videoHostUrl]);

  const onConfirm = useCallback(() => {
    if (confirmStage === 1) {
      setConfirmStage(2);
      return;
    }
    void fireReinit();
  }, [confirmStage, fireReinit]);

  return { closeConfirm, confirmStage, onConfirm, reinitBusy, reinitMessage, setConfirmStage };
}
