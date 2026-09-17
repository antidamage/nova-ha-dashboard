"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cameraUrl, cameraHostBase, normalizeVideoHost } from "../../dashboard/cameraHost";
import { FALLBACK } from "./constants";
import { normalizeProcessing } from "./processing-model";
import type { Processing } from "./types";

// Everything the Camera panel reads and writes: the processing values, the
// ingestion switch and the video-host pointer, with the queue that keeps
// slider commits in order.
export function useCameraSettings() {
  const [value, setValue] = useState<Processing>(FALLBACK);
  const [saved, setSaved] = useState<Processing>(FALLBACK);
  const [ingestionEnabled, setIngestionEnabled] = useState(true);
  const [ingestionBusy, setIngestionBusy] = useState(false);
  // The pre-configured video host: where the stream is embedded FROM. Empty =
  // nova's own same-origin routes (transition state). Seeded from the injected
  // global so the preview/status target the right host on first paint.
  const [videoHostUrl, setVideoHostUrl] = useState<string>(() => cameraHostBase());
  const [videoHostDraft, setVideoHostDraft] = useState<string>(() => cameraHostBase());
  const [videoHostBusy, setVideoHostBusy] = useState(false);
  const [videoHostMessage, setVideoHostMessage] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading camera settings...");
  const processingQueueRef = useRef<Promise<void>>(Promise.resolve());
  const processingVersionRef = useRef(0);

  const load = useCallback(async () => {
    // 1. nova config pointer (always same-origin): where the stream lives.
    const novaRes = await fetch("/api/camera/outside/settings", { cache: "no-store" });
    if (!novaRes.ok) throw new Error("Failed to load camera settings");
    const nova = (await novaRes.json()) as Partial<Processing> & {
      ingestionEnabled?: boolean;
      videoHostUrl?: string;
    };
    const host = normalizeVideoHost(nova.videoHostUrl);
    setVideoHostUrl(nova.videoHostUrl ?? "");
    setVideoHostDraft(nova.videoHostUrl ?? "");

    // 2. processing + ingestion come from whoever OWNS the capture: the remote
    //    indium host when configured, otherwise nova's own settings.
    let owner = nova;
    if (host) {
      try {
        const remoteRes = await fetch(cameraUrl("outside", "settings", host), { cache: "no-store" });
        if (remoteRes.ok) owner = (await remoteRes.json()) as typeof nova;
      } catch {
        /* remote host unreachable — keep nova's values so the panel still renders */
      }
    }
    const processing = normalizeProcessing(owner);
    setValue(processing); setSaved(processing);
    setIngestionEnabled(owner.ingestionEnabled !== false);
    setMessage("Live preview");
  }, []);

  const toggleIngestion = useCallback(async () => {
    const next = !ingestionEnabled;
    setIngestionBusy(true);
    setMessage(next ? "Starting camera ingestion..." : "Stopping camera ingestion...");
    try {
      const response = await fetch(cameraUrl("outside", "settings", videoHostUrl), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingestionEnabled: next }),
      });
      if (!response.ok) { setMessage("Failed to change camera ingestion"); return; }
      const payload = (await response.json()) as { ingestionEnabled?: boolean };
      setIngestionEnabled(payload.ingestionEnabled !== false);
      setMessage(next ? "Ingestion on — preview reconnecting..." : "Ingestion off — feed and test pattern stopped.");
    } catch {
      setMessage("Failed to change camera ingestion");
    } finally {
      setIngestionBusy(false);
    }
  }, [ingestionEnabled, videoHostUrl]);

  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, [load]);

  const save = (nextValue: Processing) => {
    const version = ++processingVersionRef.current;
    // No "applying"/"saved" banner — sliders commit on release and the status
    // line reflowing the panel drags the scroll position with it.
    setMessage("");
    processingQueueRef.current = processingQueueRef.current.catch(() => undefined).then(async () => {
      const response = await fetch(cameraUrl("outside", "settings", videoHostUrl), {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextValue),
      });
      if (!response.ok) {
        if (version === processingVersionRef.current) setMessage("Failed to save camera settings");
        return;
      }
      const processing = normalizeProcessing(await response.json() as Partial<Processing>);
      if (version === processingVersionRef.current) {
        setValue(processing);
        setSaved(processing);
      }
    });
    return processingQueueRef.current;
  };

  // Persist the video host pointer to nova config (always same-origin — nova owns
  // WHERE the stream is embedded from). Applies immediately so the preview/status
  // retarget without a reload.
  const saveVideoHost = async () => {
    const next = videoHostDraft.trim();
    setVideoHostBusy(true);
    setVideoHostMessage(null);
    try {
      const response = await fetch("/api/camera/outside/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoHostUrl: next }),
      });
      if (!response.ok) { setVideoHostMessage("Failed to save the video host."); return; }
      const payload = (await response.json()) as { videoHostUrl?: string };
      const saved = payload.videoHostUrl ?? next;
      setVideoHostUrl(saved);
      setVideoHostDraft(saved);
      setVideoHostMessage(
        normalizeVideoHost(saved)
          ? "Saved. Nova will relay this host through the dashboard's secure origin."
          : "Cleared. Falling back to this dashboard's own camera routes.",
      );
    } catch {
      setVideoHostMessage("Failed to save the video host.");
    } finally {
      setVideoHostBusy(false);
    }
  };

  return {
    ingestionBusy,
    ingestionEnabled,
    message,
    save,
    saved,
    saveVideoHost,
    setMessage,
    setValue,
    setVideoHostDraft,
    toggleIngestion,
    value,
    videoHostBusy,
    videoHostDraft,
    videoHostMessage,
    videoHostUrl,
  };
}
