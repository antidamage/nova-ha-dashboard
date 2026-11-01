import { useCallback, useEffect, useState } from "react";
import { cameraUrl } from "../cameraHost";
import { DEMO_MODE } from "./constants";
import type { SnapshotMeta } from "./types";

/**
 * Saved-capture ("snapshot") state. It belongs to the panel rather than to the
 * Advanced fold's content, which unmounts when the fold closes.
 */
export function useCameraSnapshots(cameraId: string) {
  // The whole group lives behind a closed-by-default accordion, so this stays
  // idle until the user opens it.
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [snapshotMax, setSnapshotMax] = useState(3);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
  const [confirmSnapshot, setConfirmSnapshot] = useState(false);

  const refreshSnapshots = useCallback(async () => {
    try {
      const response = await fetch(cameraUrl(cameraId, "snapshots"), { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { snapshots?: SnapshotMeta[]; max?: number };
      setSnapshots(payload.snapshots ?? []);
      if (typeof payload.max === "number") {
        setSnapshotMax(payload.max);
      }
    } catch {
      /* keep last known list */
    }
  }, [cameraId]);

  // Load the stored captures once (live mode only — the static demo has no API).
  useEffect(() => {
    if (DEMO_MODE) {
      return;
    }
    void refreshSnapshots();
  }, [refreshSnapshots]);

  const fireSnapshot = useCallback(async () => {
    setSnapshotBusy(true);
    setSnapshotMessage(null);
    try {
      const response = await fetch(cameraUrl(cameraId, "snapshots"), { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { snapshots?: SnapshotMeta[]; max?: number; error?: string }
        | null;
      if (response.ok) {
        setSnapshots(payload?.snapshots ?? []);
        if (typeof payload?.max === "number") {
          setSnapshotMax(payload.max);
        }
        setSnapshotMessage("Capture saved.");
      } else {
        setSnapshotMessage(payload?.error ?? "Failed to save the capture.");
      }
    } catch {
      setSnapshotMessage("Failed to save the capture.");
    } finally {
      setSnapshotBusy(false);
      setConfirmSnapshot(false);
    }
  }, [cameraId]);

  // Dismiss the confirm modal on Escape.
  useEffect(() => {
    if (!confirmSnapshot) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !snapshotBusy) {
        setConfirmSnapshot(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmSnapshot, snapshotBusy]);

  return {
    snapshotsOpen,
    setSnapshotsOpen,
    snapshots,
    snapshotMax,
    snapshotBusy,
    snapshotMessage,
    setSnapshotMessage,
    confirmSnapshot,
    setConfirmSnapshot,
    fireSnapshot,
  };
}

export type CameraSnapshotsState = ReturnType<typeof useCameraSnapshots>;
