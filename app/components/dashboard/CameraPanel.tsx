"use client";

import { Camera, ChevronDown, Download, Loader2, Pause, Play, Radio, Video, VideoOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as Slider from "@radix-ui/react-slider";
import { classNames } from "./shared";
import { cameraUrl } from "./cameraHost";
import { arePageUpdatesPaused } from "./pageUpdatePause";
import { SliderHapticController } from "../haptics";

const DEMO_MODE = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";

// Within this many seconds of the playlist's live edge we treat playback as
// "live" and keep following it; jumping to Live seeks just behind the edge so
// hls.js always has a buffered fragment to play.
const LIVE_EDGE_THRESHOLD_SECONDS = 8;
// Follow the live edge by sitting a few seconds BEHIND it, on fully-written,
// keyframe-aligned buffer. The previous code pinned the playhead to within 0.2s
// of the bleeding edge on every animation frame; that was fine for the synthetic
// demo clock but on the real analog capture each of those seeks lands mid-
// fragment and flashes black ~once per 2s segment — the "quick black blink".
// Instead hls.js holds the latency smoothly via maxLiveSyncPlaybackRate (it
// nudges the playback rate up when behind, no seeking), and we only ever HARD-
// seek when we've drifted so far that smooth catch-up can't recover — a genuine
// stall/gap, not normal jitter — landing on a safe target, never the edge.
const LIVE_TARGET_LATENCY_SECONDS = 6;
const LIVE_RESYNC_DRIFT_SECONDS = 12;
const STATUS_POLL_MS = 15000;
// If the backend reports the device recording but hls.js never reaches
// LEVEL_LOADED within this long, the player is stuck on a dead stream — most
// often a node/container restart that left the tab's hls.js instance
// attached to a manifest that no longer resolves. Force a fresh, cache-busted
// re-attach rather than wait forever; there is no "hard refresh" affordance on
// a mobile device running this as an installed web-app, so the panel has to
// self-heal.
const STUCK_STREAM_TIMEOUT_MS = 12000;

// Non-live (rewound) playback runs faster so you catch up to the present without
// scrubbing, then eases back to real time as you approach the live edge. Above
// FAST_PLAYBACK_THRESHOLD_SECONDS behind live we play at FAST_PLAYBACK_RATE;
// within it we return to 1x. (Live-follow keeps 1x — hls.js does its own gentle
// rate-nudging there via maxLiveSyncPlaybackRate.)
const FAST_PLAYBACK_RATE = 1.5;
const FAST_PLAYBACK_THRESHOLD_SECONDS = 60;

type CameraSource = "device" | "demo-clock";

type CameraStatus = {
  source: CameraSource;
  recording: boolean;
  ffmpegAvailable: boolean;
  deviceConnected: boolean;
  retentionSeconds: number;
  oldestSegment: string | null;
  newestSegment: string | null;
  lastError: string | null;
};

type SnapshotMeta = {
  id: string;
  createdAt: string;
  durationSeconds: number;
  sizeBytes: number;
  segmentCount: number;
};

type Hls = import("hls.js").default;

function formatClock(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatOffset(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `-${mins}m ${String(secs).padStart(2, "0")}s`;
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(mins).padStart(2, "0")}m`;
  }
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(2, "0")}s`;
  }
  return `${secs}s`;
}

function formatBytes(bytes: number) {
  if (bytes >= 1e9) {
    return `${(bytes / 1e9).toFixed(1)} GB`;
  }
  if (bytes >= 1e6) {
    return `${Math.round(bytes / 1e6)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function formatCreated(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function sourceLabel(status: CameraStatus | null) {
  if (DEMO_MODE) {
    return "Demo";
  }
  if (!status) {
    return "—";
  }
  if (status.source === "device") {
    return "Live Feed";
  }
  return "Placeholder";
}

/**
 * Draws a live "time counting up" clock onto the canvas. Used as the placeholder
 * feed in the static demo build (no server / ffmpeg) and while a real HLS stream
 * is warming up or unavailable, so the panel always shows something live.
 */
function useCanvasClock(canvasRef: React.RefObject<HTMLCanvasElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }

    let raf = 0;
    const render = () => {
      if (arePageUpdatesPaused()) {
        raf = requestAnimationFrame(render);
        return;
      }
      const width = (canvas.width = canvas.clientWidth || 640);
      const height = (canvas.height = canvas.clientHeight || 360);
      const now = new Date();

      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, width, height);

      // Faint scanline texture to read as a CCTV feed.
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      for (let y = 0; y < height; y += 4) {
        ctx.fillRect(0, y, width, 1);
      }

      ctx.fillStyle = "rgba(120,255,210,0.9)";
      ctx.font = `${Math.round(height * 0.16)}px var(--cyber-mono, monospace)`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(formatClock(now), width / 2, height / 2 - height * 0.04);

      ctx.fillStyle = "rgba(180,200,210,0.6)";
      ctx.font = `${Math.round(height * 0.05)}px var(--cyber-mono, monospace)`;
      ctx.fillText(now.toLocaleDateString(), width / 2, height / 2 + height * 0.12);

      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,80,80,0.95)";
      ctx.font = `${Math.round(height * 0.045)}px var(--cyber-mono, monospace)`;
      ctx.fillText("● REC", 18, 28);

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [active, canvasRef]);
}

export function CameraPanel({ cameraId, className }: { cameraId: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [status, setStatus] = useState<CameraStatus | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  // Bumping this forces the HLS-attach effect below to tear down and rebuild
  // with a cache-busted URL — the actual "cache-break", not a page reload.
  const [reattachToken, setReattachToken] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const [seekable, setSeekable] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [currentTime, setCurrentTime] = useState(0);
  const [playingDate, setPlayingDate] = useState<Date | null>(null);
  // Suppresses live-follow while the user is dragging the scrubber.
  const scrubbingRef = useRef(false);
  const scrubHapticsRef = useRef(new SliderHapticController());
  const lastScrubHapticValueRef = useRef<number | null>(null);
  // Latched "follow live" flag read by the RAF sample loop. Set true only by the
  // Live button (and the initial mount), cleared by scrubbing or a user pause.
  const isLiveRef = useRef(true);

  const setLive = useCallback((live: boolean) => {
    isLiveRef.current = live;
    setIsLive(live);
  }, []);

  // Saved-capture ("snapshot") state. The whole group lives behind a closed-by-
  // default accordion, so this stays idle until the user opens it.
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [snapshotMax, setSnapshotMax] = useState(3);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
  const [confirmSnapshot, setConfirmSnapshot] = useState(false);

  // "No signal": a real (non-demo) feed that isn't recording and has no live
  // stream — the capture device is absent. Computed here so the placeholder clock
  // can be suppressed in that state (we show a plain "No signal", never a clock).
  const offline = !DEMO_MODE && status !== null && !status.recording && !streamReady;
  // The canvas clock is only a warming-up/demo placeholder — never a stand-in for
  // a missing camera. Suppress it when offline so the panel reads "No signal".
  const showPlaceholder = DEMO_MODE || !streamReady;
  const showPlaceholderClock = showPlaceholder && !offline;
  useCanvasClock(canvasRef, showPlaceholderClock);

  // Poll backend status (live mode only — the static demo has no API).
  useEffect(() => {
    if (DEMO_MODE) {
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch(cameraUrl(cameraId, "status"), { cache: "no-store" });
        if (response.ok && alive) {
          setStatus((await response.json()) as CameraStatus);
        }
      } catch {
        /* keep last known status */
      }
    };
    void load();
    const timer = window.setInterval(load, STATUS_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [cameraId]);

  // Attach the HLS stream (live mode only).
  useEffect(() => {
    if (DEMO_MODE) {
      return;
    }
    const video = videoRef.current;
    if (!video) {
      return;
    }

    // Cache-bust: a query param that changes on every re-attach so a stale
    // manifest can never be served from an intermediate cache (browser HTTP
    // cache, a CDN/proxy, or an OS-level PWA cache on mobile) after a node
    // restart on the source host.
    const src = `${cameraUrl(cameraId, "index.m3u8")}?_=${Date.now()}`;
    let cancelled = false;
    let cleanup = () => {};

    const onReady = () => {
      if (!cancelled) {
        setStreamReady(true);
      }
    };

    (async () => {
      const canNativeHls = video.canPlayType("application/vnd.apple.mpegurl");
      const { default: HlsLib } = await import("hls.js");

      if (HlsLib.isSupported()) {
        const hls = new HlsLib({
          // Keep the full rolling window seekable; old fragments are refetched
          // from the server on demand so memory stays bounded.
          backBufferLength: 90,
          liveSyncDurationCount: 3,
          // Maintain live latency by gently speeding playback up (up to 1.5x)
          // when we fall behind, instead of seeking to the edge — seeking is
          // what flashed black every segment. The feed is muted so the faster
          // rate is imperceptible.
          maxLiveSyncPlaybackRate: 1.5,
          maxBufferLength: 30,
          manifestLoadingMaxRetry: 8,
          manifestLoadingRetryDelay: 1000,
        });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(HlsLib.Events.LEVEL_LOADED, onReady);
        hls.on(HlsLib.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case HlsLib.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case HlsLib.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                if (!cancelled) {
                  setStreamReady(false);
                }
            }
          }
        });
        cleanup = () => {
          hls.destroy();
          hlsRef.current = null;
        };
      } else if (canNativeHls) {
        video.src = src;
        video.addEventListener("loadedmetadata", onReady);
        cleanup = () => {
          video.removeEventListener("loadedmetadata", onReady);
          video.removeAttribute("src");
          video.load();
        };
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
      setStreamReady(false);
    };
  }, [cameraId, reattachToken]);

  // Self-heal a stuck stream: if the backend says the device is recording but
  // this tab's hls.js never reaches LEVEL_LOADED within STUCK_STREAM_TIMEOUT_MS,
  // force a cache-busted re-attach instead of sitting on the placeholder clock
  // forever. Covers the case a page reload doesn't fix (a mobile installed
  // web-app has no hard-refresh gesture, and even a soft reload can rehydrate
  // into the same stuck hls.js state).
  useEffect(() => {
    if (DEMO_MODE || streamReady || !status?.recording) {
      return;
    }
    const timer = window.setTimeout(() => {
      setReattachToken((token) => token + 1);
    }, STUCK_STREAM_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [status?.recording, streamReady]);

  // Also re-attach whenever the tab/PWA comes back to the foreground — mobile
  // devices suspend timers while backgrounded, so a stream that died while the
  // screen was locked would otherwise wait for the next natural re-render.
  useEffect(() => {
    if (DEMO_MODE) {
      return;
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && !streamReady) {
        setReattachToken((token) => token + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [streamReady]);

  // Track playback position + seekable window from the <video> element.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || DEMO_MODE) {
      return;
    }

    let raf = 0;
    const sample = () => {
      if (arePageUpdatesPaused()) {
        raf = requestAnimationFrame(sample);
        return;
      }
      const seekableRange = video.seekable;
      if (seekableRange.length > 0) {
        const start = seekableRange.start(0);
        const end = seekableRange.end(seekableRange.length - 1);
        setSeekable({ start, end });
        // hls.js keeps us ~LIVE_TARGET_LATENCY_SECONDS behind the edge on its own
        // (rate-nudging via maxLiveSyncPlaybackRate, no seeks). We only step in to
        // HARD-seek when we've fallen so far back that catch-up can't recover, and
        // then we land on a safe target a few seconds behind the edge — never on
        // the bleeding edge, and only ever jumping FORWARD (an hls.js playlist
        // reload can briefly collapse the seekable window; a backward snap would
        // land on the oldest frame — the original oldest<->newest flicker).
        if (isLiveRef.current && !scrubbingRef.current && !video.seeking) {
          const behind = end - video.currentTime;
          const target = end - LIVE_TARGET_LATENCY_SECONDS;
          if (behind > LIVE_RESYNC_DRIFT_SECONDS && target > video.currentTime && target > start) {
            video.currentTime = target;
          }
          if (video.paused) {
            void video.play().catch(() => {});
          }
          // Live-follow: leave playbackRate alone — hls.js owns it here, gently
          // nudging up to maxLiveSyncPlaybackRate to hold latency without seeking
          // (jumpToLive already reset us to 1x before latching live).
        } else if (!scrubbingRef.current && !video.paused && !video.seeking) {
          // Rewound playback: race toward the present at FAST_PLAYBACK_RATE, then
          // ease back to 1x within the last minute so the catch-up lands smoothly.
          const behind = end - video.currentTime;
          const desired = behind > FAST_PLAYBACK_THRESHOLD_SECONDS ? FAST_PLAYBACK_RATE : 1;
          if (Math.abs(video.playbackRate - desired) > 0.01) {
            video.playbackRate = desired;
          }
        }
      }
      setCurrentTime(video.currentTime);
      const hlsPlayingDate = hlsRef.current?.playingDate ?? null;
      setPlayingDate(hlsPlayingDate ?? null);
      raf = requestAnimationFrame(sample);
    };
    raf = requestAnimationFrame(sample);

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);

    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, []);

  const jumpToLive = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const seekableRange = video.seekable;
    if (seekableRange.length > 0) {
      const end = seekableRange.end(seekableRange.length - 1);
      video.currentTime = Math.max(end - LIVE_TARGET_LATENCY_SECONDS, seekableRange.start(0));
    }
    scrubbingRef.current = false;
    video.playbackRate = 1;
    setLive(true);
    void video.play().catch(() => {});
  }, [setLive]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      void video.play().catch(() => {});
    } else {
      // A user pause drops us out of live-follow so the frame stays put.
      setLive(false);
      video.pause();
    }
  }, [setLive]);

  const handleScrub = useCallback((values: number[]) => {
    const video = videoRef.current;
    if (!video || values.length === 0) {
      return;
    }
    scrubbingRef.current = true;
    const normalizedValue = (values[0] - seekable.start) / Math.max(1, seekable.end - seekable.start);
    const previous = lastScrubHapticValueRef.current;
    if (previous !== null) scrubHapticsRef.current.move(normalizedValue - previous, { value: values[0] });
    lastScrubHapticValueRef.current = normalizedValue;
    setLive(false);
    video.currentTime = values[0];
    setCurrentTime(values[0]);
  }, [seekable.end, seekable.start, setLive]);

  const commitScrub = useCallback((values: number[]) => {
    const video = videoRef.current;
    scrubbingRef.current = false;
    scrubHapticsRef.current.stop();
    lastScrubHapticValueRef.current = null;
    if (video && values.length > 0) {
      video.currentTime = values[0];
      void video.play().catch(() => {});
    }
  }, []);

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

  const windowSeconds = Math.max(1, seekable.end - seekable.start);
  const behindLiveSeconds = Math.max(0, seekable.end - currentTime);
  const liveEdgeDate = status?.newestSegment ? new Date(status.newestSegment) : new Date();
  const currentDate =
    playingDate ?? (behindLiveSeconds >= 0 ? new Date(liveEdgeDate.getTime() - behindLiveSeconds * 1000) : liveEdgeDate);
  const windowStartDate = new Date(liveEdgeDate.getTime() - windowSeconds * 1000);
  const hasDvr = !DEMO_MODE && streamReady && windowSeconds > LIVE_EDGE_THRESHOLD_SECONDS;
  // While following live the player constantly re-seeks, which fires transient
  // pause/play events; treat live as "playing" so the control icon stays stable.
  const showAsPlaying = isLive || playing;

  return (
    <section className={classNames("camera-panel", className)}>
      <header className="camera-panel-header">
        <div className="flex items-center gap-2">
          {offline ? <VideoOff className="h-4 w-4 text-rose-300" /> : <Video className="h-4 w-4 text-cyan-300" />}
          <span className="text-sm font-black uppercase text-cyan-200">Outside Camera</span>
        </div>
        <span className="camera-source-badge">{sourceLabel(status)}</span>
      </header>

      <div className="camera-stage">
        <video
          ref={videoRef}
          className={classNames("camera-video", showPlaceholder && "opacity-0")}
          playsInline
          muted
          autoPlay
        />
        <canvas ref={canvasRef} className={classNames("camera-canvas", !showPlaceholderClock && "hidden")} />

        <div className={classNames("camera-live-pill", isLive ? "is-live" : "is-rewound")}>
          <span className="camera-live-dot" />
          {isLive ? "LIVE" : formatOffset(behindLiveSeconds)}
        </div>

        {offline ? (
          <div className="camera-offline-overlay">
            <VideoOff className="h-8 w-8 text-rose-300" />
            <p className="mt-2 text-sm font-black uppercase text-rose-100">No signal</p>
            <p className="mt-1 text-xs text-neutral-400">Waiting for capture device</p>
          </div>
        ) : null}
      </div>

      <div className="camera-controls">
        <button type="button" className="camera-control-button" onClick={togglePlay} aria-label={showAsPlaying ? "Pause" : "Play"}>
          {showAsPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </button>

        <div className="camera-timeline">
          <Slider.Root
            className="camera-slider"
            min={seekable.start}
            max={seekable.end}
            value={[isLive ? seekable.end : Math.min(Math.max(currentTime, seekable.start), seekable.end)]}
            step={0.5}
            disabled={!hasDvr}
            onPointerDown={() => {
              if (!hasDvr) return;
              scrubHapticsRef.current.start({
                value: isLive ? seekable.end : Math.min(Math.max(currentTime, seekable.start), seekable.end),
                step: 0.5,
              });
              lastScrubHapticValueRef.current = null;
            }}
            onPointerCancel={() => {
              scrubHapticsRef.current.stop();
              lastScrubHapticValueRef.current = null;
            }}
            onValueChange={handleScrub}
            onValueCommit={commitScrub}
          >
            <Slider.Track className="camera-slider-track">
              <Slider.Range className="camera-slider-range" />
            </Slider.Track>
            <Slider.Thumb className="camera-slider-thumb" aria-label="Scrub recording" />
          </Slider.Root>
          <div className="camera-timeline-labels">
            <span>{hasDvr ? formatClock(windowStartDate) : "—"}</span>
            <span className="camera-timeline-current">{isLive ? "LIVE" : formatClock(currentDate)}</span>
            <span>LIVE</span>
          </div>
        </div>

        <button
          type="button"
          className={classNames("camera-live-button", isLive && "is-active")}
          onClick={jumpToLive}
          disabled={DEMO_MODE}
        >
          <Radio className="h-4 w-4" />
          Live
        </button>
      </div>

      {!DEMO_MODE ? (
        <div className="camera-snapshots">
          <button
            type="button"
            className="camera-snapshots-toggle"
            aria-expanded={snapshotsOpen}
            onClick={() => setSnapshotsOpen((open) => !open)}
          >
            <ChevronDown
              className={classNames("camera-snapshots-chevron h-4 w-4", snapshotsOpen && "is-open")}
              aria-hidden="true"
            />
            <Camera className="h-4 w-4" aria-hidden="true" />
            <span className="camera-snapshots-title">Saved Captures</span>
            <span className="camera-snapshots-count">
              {snapshots.length}/{snapshotMax}
            </span>
          </button>

          {snapshotsOpen ? (
            <div className="camera-snapshots-body">
              <div className="camera-snapshots-actions">
                <button
                  type="button"
                  className="camera-snapshot-save"
                  disabled={!hasDvr || snapshotBusy}
                  onClick={() => {
                    setSnapshotMessage(null);
                    setConfirmSnapshot(true);
                  }}
                >
                  {snapshotBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Camera className="h-4 w-4" aria-hidden="true" />
                  )}
                  Save last 2 hours
                </button>
                {snapshotMessage ? (
                  <span className="camera-snapshots-message">{snapshotMessage}</span>
                ) : null}
              </div>

              <p className="camera-snapshots-hint">
                Freezes the buffered footage to disk. Only the {snapshotMax} most recent captures are kept — saving a
                new one deletes the oldest.
              </p>

              {snapshots.length === 0 ? (
                <p className="camera-snapshots-empty">No saved captures yet.</p>
              ) : (
                <ul className="camera-snapshots-list">
                  {snapshots.map((snapshot) => (
                    <li key={snapshot.id} className="camera-snapshot-item">
                      <div className="camera-snapshot-meta">
                        <span className="camera-snapshot-when">{formatCreated(snapshot.createdAt)}</span>
                        <span className="camera-snapshot-size">
                          {formatDuration(snapshot.durationSeconds)} · {formatBytes(snapshot.sizeBytes)}
                        </span>
                      </div>
                      <a
                        className="camera-snapshot-download"
                        href={cameraUrl(cameraId, `snapshots/${snapshot.id}`)}
                        download
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {confirmSnapshot && typeof document !== "undefined"
        ? createPortal(
            <div
              className="system-confirm-overlay"
              role="presentation"
              onClick={() => {
                if (!snapshotBusy) {
                  setConfirmSnapshot(false);
                }
              }}
            >
              <div
                className="system-confirm-card"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="camera-snapshot-title"
                aria-describedby="camera-snapshot-body"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="system-stripe system-stripe-top" aria-hidden="true" />
                <span className="system-stripe system-stripe-bottom" aria-hidden="true" />
                <p className="system-confirm-step">Save capture</p>
                <h3 id="camera-snapshot-title" className="system-confirm-title">
                  Save the last two hours?
                </h3>
                <p id="camera-snapshot-body" className="system-confirm-body">
                  This writes the currently buffered footage to disk as a downloadable capture. Only the {snapshotMax}{" "}
                  most recent captures are kept — saving this one deletes the oldest if there are already {snapshotMax}.
                </p>
                <div className="system-confirm-actions">
                  <button
                    type="button"
                    className="system-confirm-cancel"
                    disabled={snapshotBusy}
                    onClick={() => setConfirmSnapshot(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="system-confirm-go"
                    disabled={snapshotBusy}
                    onClick={() => void fireSnapshot()}
                  >
                    {snapshotBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save capture now
                  </button>
                </div>
                <p className="system-confirm-dismiss-hint">Tap anywhere outside this box to cancel.</p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
