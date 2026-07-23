"use client";

import { Camera, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConfigAccordion } from "./ConfigControls";
import { DotLineControl } from "./DotControls";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import { cameraUrl, cameraHostBase, normalizeVideoHost } from "./dashboard/cameraHost";
import { useAgentName } from "./AgentNameContext";

const DEMO_MODE = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";

type Processing = { brightness: number; contrast: number; sharpness: number };

type CameraStatus = {
  deviceState: string;
  statusReason: string;
  healthy: boolean;
  source: string;
  newestSegmentAgeSeconds: number | null;
  consecutiveStalls: number;
};

// Map the recorder's classified deviceState to a short label + tone for the
// status readout, so a human can see WHEN and WHY the feed is (not) working.
const STATE_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" }> = {
  streaming: { label: "Streaming (live)", tone: "ok" },
  starting: { label: "Starting…", tone: "warn" },
  "demo-fallback": { label: "Test pattern (no device)", tone: "warn" },
  "device-absent": { label: "Device not detected", tone: "bad" },
  "device-busy": { label: "Device busy", tone: "bad" },
  "device-stalled": { label: "Device stalled (wedged)", tone: "bad" },
  "device-error": { label: "Encoder error", tone: "bad" },
  paused: { label: "Paused (re-initialising)", tone: "warn" },
  stopped: { label: "Stopped", tone: "bad" },
  unavailable: { label: "No encoder", tone: "bad" },
};

const FALLBACK: Processing = { brightness: -0.12, contrast: 1.1, sharpness: 0.6 };

function normalizeProcessing(value: Partial<Processing> | null | undefined): Processing {
  return {
    brightness: typeof value?.brightness === "number" ? value.brightness : FALLBACK.brightness,
    contrast: typeof value?.contrast === "number" ? value.contrast : FALLBACK.contrast,
    sharpness: typeof value?.sharpness === "number" ? value.sharpness : FALLBACK.sharpness,
  };
}

function Setting({ label, min, max, step, value, onChange, onCommit }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void; onCommit: (value: number) => void;
}) {
  return (
    <div className="grid gap-2 border border-cyan-300/20 bg-neutral-900/70 p-3">
      <span className="flex justify-between text-sm font-black uppercase text-cyan-200">
        {label}<span className="font-mono text-neutral-100">{value.toFixed(2)}</span>
      </span>
      <DotLineControl
        ariaLabel={label}
        ariaValueText={value.toFixed(2)}
        min={min}
        max={max}
        step={step}
        value={value}
        fill
        onChange={onChange}
        onCommit={onCommit}
      />
    </div>
  );
}

export function CameraConfig() {
  const { agentName } = useAgentName();
  const videoRef = useRef<HTMLVideoElement | null>(null);
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
  const [status, setStatus] = useState<CameraStatus | null>(null);
  // Double-confirm modal for the destructive re-init (like System Power).
  const [confirmStage, setConfirmStage] = useState<0 | 1 | 2>(0);
  const [reinitBusy, setReinitBusy] = useState(false);
  const [reinitMessage, setReinitMessage] = useState<string | null>(null);

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

  // Poll the recorder status so the panel always shows the live device state
  // (streaming / test-pattern / stalled / absent …) and the human "why".
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const response = await fetch(cameraUrl("outside", "status", videoHostUrl), { cache: "no-store" });
        if (response.ok && !cancelled) {
          setStatus((await response.json()) as CameraStatus);
        }
      } catch {
        /* transient; keep the last known status */
      }
      if (!cancelled) {
        timer = setTimeout(tick, 5000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [videoHostUrl]);

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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    let destroy: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const onPlaying = () => setMessage("Live preview");
    video.addEventListener("playing", onPlaying);
    void import("hls.js").then(({ default: Hls }) => {
      if (disposed) return;
      if (!Hls.isSupported()) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = `${cameraUrl("outside", "index.m3u8", videoHostUrl)}?preview=${Date.now()}`;
          void video.play().catch(() => undefined);
        }
        return;
      }

      // Applying processing stops ffmpeg, purges the segment dir and restarts it,
      // so the playlist 404s for a second or two while it warms up. hls.js gives
      // up on a manifest that never loaded (startLoad/recoverMediaError can't
      // resurrect it), so on a fatal network error we tear the instance down and
      // rebuild it with a fresh manifest request until the recorder comes back —
      // letting the preview ride out the warmup gap instead of going black.
      const retryConfig = { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 2000 };
      const loadPolicy = {
        maxTimeToFirstByteMs: 10000,
        maxLoadTimeMs: 20000,
        timeoutRetry: retryConfig,
        errorRetry: retryConfig,
      };

      const start = () => {
        if (disposed) return;
        const hls = new Hls({
          liveSyncDurationCount: 1,
          maxLiveSyncPlaybackRate: 1.5,
          manifestLoadPolicy: { default: loadPolicy },
          playlistLoadPolicy: { default: loadPolicy },
        });
        destroy = () => hls.destroy();
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || disposed) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
          hls.destroy();
          retry = setTimeout(start, 1000);
        });
        hls.loadSource(`${cameraUrl("outside", "index.m3u8", videoHostUrl)}?preview=${Date.now()}`);
        hls.attachMedia(video);
        void video.play().catch(() => undefined);
      };
      start();
    });
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      video.removeEventListener("playing", onPlaying);
      destroy?.();
    };
  }, [saved, videoHostUrl]);

  const save = (nextValue: Processing) => {
    const version = ++processingVersionRef.current;
    setMessage("Applying camera processing...");
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
        setMessage("Saved automatically. Preview reconnecting...");
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
          ? "Saved. Embedding the stream directly from this host."
          : "Cleared. Falling back to this dashboard's own camera routes.",
      );
    } catch {
      setVideoHostMessage("Failed to save the video host.");
    } finally {
      setVideoHostBusy(false);
    }
  };

  return (
    <ConfigAccordion id="camera" title="Camera" icon={<Camera className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <div className="grid gap-3">
          <div className="grid gap-2 border border-cyan-300/20 bg-neutral-900/70 p-3">
            <span className="text-sm font-black uppercase text-cyan-200">Video host URL</span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="url"
                spellCheck={false}
                autoComplete="off"
                placeholder="http://nocturnium.local:8080"
                value={videoHostDraft}
                disabled={DEMO_MODE || videoHostBusy}
                onChange={(event) => setVideoHostDraft(event.target.value)}
                onBlur={() => {
                  if (videoHostDraft.trim() !== videoHostUrl.trim()) void saveVideoHost();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="min-w-0 flex-1 border border-cyan-300/30 bg-neutral-950/80 px-2 py-1.5 font-mono text-sm text-neutral-100 outline-none focus:border-cyan-300/70"
              />
              {videoHostBusy ? <Loader2 className="h-4 w-4 animate-spin text-cyan-200" aria-label="Saving video host" /> : null}
            </div>
            <span className="text-xs text-neutral-400">
              {videoHostMessage ??
                "Where the Outside camera stream is served from (currently Nocturnium, e.g. http://nocturnium.local:8080). Leave blank to use this dashboard's own camera routes."}
            </span>
          </div>

          <div className="grid gap-2 border border-cyan-300/20 bg-neutral-900/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-black uppercase text-cyan-200">Camera ingestion</span>
              <button
                type="button"
                role="switch"
                aria-checked={ingestionEnabled}
                aria-label="Camera ingestion"
                disabled={DEMO_MODE || ingestionBusy}
                onClick={() => void toggleIngestion()}
                className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors ${
                  ingestionEnabled ? "border-emerald-300/60 bg-emerald-500/30" : "border-neutral-600 bg-neutral-800"
                } ${ingestionBusy ? "opacity-60" : ""}`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block h-5 w-5 transform rounded-full bg-neutral-100 transition-transform ${
                    ingestionEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            <span className="text-xs text-neutral-400">
              {ingestionEnabled
                ? "On — the recorder captures the feed (or shows the test pattern if no device). Turn off to stop ffmpeg entirely and reduce CPU load."
                : "Off — no ffmpeg runs: the live feed AND the test pattern are stopped to reduce CPU load. Turn on to resume the DVR."}
            </span>
          </div>

          <Setting label="Brightness" min={-1} max={1} step={0.01} value={value.brightness} onChange={(brightness) => setValue({ ...value, brightness })} onCommit={(brightness) => void save({ ...value, brightness })} />
          <Setting label="Contrast" min={0} max={2} step={0.01} value={value.contrast} onChange={(contrast) => setValue({ ...value, contrast })} onCommit={(contrast) => void save({ ...value, contrast })} />
          <Setting label="Sharpness" min={0} max={5} step={0.1} value={value.sharpness} onChange={(sharpness) => setValue({ ...value, sharpness })} onCommit={(sharpness) => void save({ ...value, sharpness })} />
          <div className="flex items-center gap-3">
            <button type="button" className="config-page-button" onClick={() => { setValue(FALLBACK); void save(FALLBACK); }}>Reset</button>
            <span className="text-sm text-neutral-400">{message}</span>
          </div>

          <div className="grid gap-2 border border-cyan-300/20 bg-neutral-900/70 p-3">
            <span className="text-sm font-black uppercase text-cyan-200">Feed status</span>
            {(() => {
              const meta = status ? STATE_LABEL[status.deviceState] : null;
              const dotColor = !status
                ? "#64748b"
                : meta?.tone === "ok"
                  ? "#34d399"
                  : meta?.tone === "warn"
                    ? "#fbbf24"
                    : "#f87171";
              return (
                <>
                  <span className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
                    <span
                      aria-hidden="true"
                      style={{ width: 10, height: 10, borderRadius: 9999, background: dotColor, display: "inline-block" }}
                    />
                    {status ? meta?.label ?? status.deviceState : "Checking…"}
                    {status?.newestSegmentAgeSeconds != null ? (
                      <span className="font-mono text-xs text-neutral-500">({status.newestSegmentAgeSeconds}s ago)</span>
                    ) : null}
                  </span>
                  {status?.statusReason ? (
                    <span className="text-xs text-neutral-400">{status.statusReason}</span>
                  ) : null}
                </>
              );
            })()}
            <div className="mt-1 flex items-center gap-3">
              <MomentaryFeedbackButton
                type="button"
                className="config-page-button flex items-center gap-2"
                disabled={DEMO_MODE || reinitBusy}
                onClick={() => setConfirmStage(1)}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Re-initialise Camera
              </MomentaryFeedbackButton>
              {reinitMessage ? <span className="text-xs text-cyan-200">{reinitMessage}</span> : null}
            </div>
          </div>
        </div>
        <div>
          <video ref={videoRef} className="camera-config-preview" autoPlay muted playsInline />
        </div>
      </div>

      {confirmStage !== 0 && typeof document !== "undefined"
        ? createPortal(
            <div className="system-confirm-overlay" role="presentation" onClick={closeConfirm}>
              <div
                className="system-confirm-card"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="camera-reinit-title"
                aria-describedby="camera-reinit-body"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="system-stripe system-stripe-top" aria-hidden="true" />
                <span className="system-stripe system-stripe-bottom" aria-hidden="true" />
                <p className="system-confirm-step">
                  {confirmStage === 1 ? "Confirmation 1 of 2" : "Confirmation 2 of 2 — last chance"}
                </p>
                <h3 id="camera-reinit-title" className="system-confirm-title">
                  {confirmStage === 1 ? "Re-initialise the Outside camera?" : "Final confirmation"}
                </h3>
                <p id="camera-reinit-body" className="system-confirm-body">
                  {confirmStage === 1
                    ? "This restarts the camera recorder and performs a full USB re-initialisation of the capture device (free it, reset it, re-enumerate it). The live feed and DVR scrub-back window will drop for up to a minute while it comes back. The dashboard, Home Assistant and everything else stay running."
                    : `This is your last chance to stop. The Outside camera feed will go down and rebuild; the last couple of hours of DVR scrub-back will reset. Nothing else on ${agentName} is affected.`}
                </p>
                <div className="system-confirm-actions">
                  <button type="button" className="system-confirm-cancel" disabled={reinitBusy} onClick={closeConfirm}>
                    Cancel
                  </button>
                  <button type="button" className="system-confirm-go" disabled={reinitBusy} onClick={onConfirm}>
                    {reinitBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {confirmStage === 1 ? "Yes, re-initialise the camera" : "Re-initialise the camera now"}
                  </button>
                </div>
                <p className="system-confirm-dismiss-hint">Tap anywhere outside this box to cancel.</p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </ConfigAccordion>
  );
}
