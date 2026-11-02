import { useCallback, useEffect, useState } from "react";
import type { SavedRangeSummary } from "../../../../lib/camera/saved-ranges-model";
import { downloadName } from "../../../../lib/camera/saved-ranges-model";
import { DEMO_MODE } from "./constants";

const SAVING_POLL_MS = 2000;

function rangesUrl(cameraId: string, path = "") {
  return `/api/camera/${encodeURIComponent(cameraId)}/saved${path}`;
}

/** The saved-range list, and everything done to it. specs/camera-saved-ranges.md. */
export function useSavedRanges(cameraId: string) {
  const [ranges, setRanges] = useState<SavedRangeSummary[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(rangesUrl(cameraId), { cache: "no-store" });
      if (response.ok) setRanges(((await response.json()) as { ranges?: SavedRangeSummary[] }).ranges ?? []);
    } catch {
      /* keep the last known list */
    }
  }, [cameraId]);

  useEffect(() => {
    if (!DEMO_MODE) void refresh();
  }, [refresh]);

  const saving = ranges.some((range) => range.state === "saving");
  useEffect(() => {
    if (!saving) {
      return;
    }
    const timer = window.setInterval(() => void refresh(), SAVING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, saving]);

  const save = useCallback(async (startMs: number, endMs: number) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(rangesUrl(cameraId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startMs, endMs }),
      });
      if (!response.ok) {
        setMessage(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not save that range.");
        return false;
      }
      await refresh();
      return true;
    } catch {
      setMessage("Could not save that range.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [cameraId, refresh]);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(rangesUrl(cameraId, `/${id}`), { method: "DELETE" });
      if (!response.ok) setMessage("Could not delete that range.");
      await refresh();
    } catch {
      setMessage("Could not delete that range.");
    } finally {
      setBusy(false);
    }
  }, [cameraId, refresh]);

  /** Checks first, so a busy card says so here rather than downloading an error. */
  const download = useCallback(async (range: SavedRangeSummary) => {
    setMessage(null);
    const proxy = `/api/camera-proxy/${encodeURIComponent(cameraId)}/smooth`;
    const status = await fetch(`${proxy}/status`, { cache: "no-store" }).catch(() => null);
    if (!status?.ok) {
      setMessage("The frame smoothing service is not running.");
      return;
    }
    if (((await status.json()) as { rendering?: boolean }).rendering) {
      setMessage("Another download is using the GPU. Try again when it finishes.");
      return;
    }
    const name = downloadName(cameraId, range.startMs);
    const link = document.createElement("a");
    link.href = `${proxy}/render/${range.id}.mp4?name=${encodeURIComponent(name)}`;
    link.download = name;
    link.click();
  }, [cameraId]);

  return { ranges, message, busy, save, remove, download };
}

export type SavedRangesState = ReturnType<typeof useSavedRanges>;
