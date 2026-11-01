"use client";

import { Pause, Play, Radio, Video, VideoOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Slider from "@radix-ui/react-slider";
import { classNames } from "../shared";
import { cameraUrl } from "../cameraHost";
import { arePageUpdatesPaused } from "../pageUpdatePause";
import { SliderHapticController } from "../../haptics";
import { AdvancedFold } from "../AdvancedFold";
import { CameraEventReport } from "./CameraEventReport";
import { CameraJogDial } from "./CameraJogDial";
import { CameraSnapshotConfirm, CameraSnapshots } from "./CameraSnapshots";
import { useCameraJog } from "./useCameraJog";
import { useCameraSnapshots } from "./useCameraSnapshots";
import { demoAssetUrl } from "../../../../lib/demo-assets";
import {
  DEMO_MODE,
  LIVE_EDGE_THRESHOLD_SECONDS,
  LIVE_RESYNC_DRIFT_SECONDS,
  LIVE_SYNC_MAX_RATE,
  LIVE_TARGET_LATENCY_SECONDS,
  STATUS_POLL_MS,
  STUCK_STREAM_TIMEOUT_MS,
} from "./constants";
import type { CameraStatus, Hls } from "./types";
import { formatClock, formatOffset, sourceLabel } from "./format-model";
import { useCanvasClock } from "./useCanvasClock";
import { forwardPlaybackRate, jogReachedLiveEdge } from "./jog-model";
import { prefersNativeHls } from "./hls-engine-model";

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
  const [streamStartAt, setStreamStartAt] = useState<number | null>(null);
  const [scrubTargetMs, setScrubTargetMs] = useState<number | null>(null);
  const statusRef = useRef<CameraStatus | null>(null);
  const streamStartAtRef = useRef<number | null>(null);
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

  const { jog, jogRef, reversing, selectRate, clearJog, toggleReverse } = useCameraJog({ videoRef, scrubbingRef, isLiveRef, setLive });

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    streamStartAtRef.current = streamStartAt;
  }, [streamStartAt]);

  const snapshotState = useCameraSnapshots(cameraId);

  // "No signal": a real (non-demo) feed that isn't recording and has no live
  // stream — the capture device is absent. Computed here so the placeholder clock
  // can be suppressed in that state (we show a plain "No signal", never a clock).
  const offline = !DEMO_MODE && status !== null && !status.recording && !streamReady;
  // The canvas clock is only a warming-up/demo placeholder — never a stand-in for
  // a missing camera. Suppress it when offline so the panel reads "No signal".
  const showPlaceholder = DEMO_MODE || !streamReady;
  const showPlaceholderClock = showPlaceholder && !offline && !DEMO_MODE;
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
    const query = new URLSearchParams({ _: String(Date.now()) });
    if (streamStartAt !== null) query.set("start", String(Math.round(streamStartAt)));
    const src = `${cameraUrl(cameraId, "index.m3u8")}?${query}`;
    let cancelled = false;
    let positionedHistoricalStream = false;
    let cleanup = () => {};

    const onReady = () => {
      if (!cancelled) {
        setStreamReady(true);
        if (streamStartAt !== null && !positionedHistoricalStream) {
          positionedHistoricalStream = true;
          const range = video.seekable;
          if (range.length > 0) video.currentTime = range.start(0);
          setLive(false);
          setPlayingDate(new Date(streamStartAt));
          setScrubTargetMs(null);
          void video.play().catch(() => {});
        }
      }
    };

    (async () => {
      const canNativeHls = prefersNativeHls(video.canPlayType("application/vnd.apple.mpegurl"), navigator.userAgent);

      // Prefer native HLS whenever the platform offers it (Safari/WebKit on
      // macOS and iOS). Hls.isSupported() only checks for a MediaSource
      // implementation, and WebKit exposes just enough of one to pass that
      // check — but its MSE path for LIVE HLS is the well-documented flaky
      // one: it silently never reaches a ready state, no error, no console
      // output, just the placeholder forever (verified live via a WebKit
      // repro — currentSrc stayed "", zero manifest requests). Safari's
      // native engine (this canPlayType branch) is the reliable, hardware-
      // backed one; hls.js/MSE is the correct choice only where there is no
      // native engine worth using (Chrome, Firefox, Brave, desktop generally);
      // see hls-engine-model.ts for why Chromium's own does not count.
      if (canNativeHls) {
        video.src = src;
        video.addEventListener("loadedmetadata", onReady);
        cleanup = () => {
          video.removeEventListener("loadedmetadata", onReady);
          video.removeAttribute("src");
          video.load();
        };
        return;
      }

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
          maxLiveSyncPlaybackRate: LIVE_SYNC_MAX_RATE,
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
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
      setStreamReady(false);
    };
  }, [cameraId, reattachToken, setLive, streamStartAt]);

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

  const jumpToLive = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    clearJog();
    if (streamStartAtRef.current !== null) {
      setStreamStartAt(null);
      setScrubTargetMs(null);
      video.playbackRate = 1;
      setLive(true);
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
    setScrubTargetMs(null);
    void video.play().catch(() => {});
  }, [clearJog, setLive]);

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
        if (hlsRef.current) {
          hlsRef.current.config.maxLiveSyncPlaybackRate = jogRef.current === null ? LIVE_SYNC_MAX_RATE : 1;
        }
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
          // Rewound playback: a set jog is obeyed. Otherwise race toward the present
          // at FAST_PLAYBACK_RATE, then ease back to 1x within the last minute so the
          // catch-up lands smoothly.
          const behind = end - video.currentTime;
          const desired = forwardPlaybackRate(jogRef.current, behind);
          if (jogReachedLiveEdge(jogRef.current, behind)) {
            jumpToLive();
          } else if (Math.abs(video.playbackRate - desired) > 0.01) {
            video.playbackRate = desired;
          }
        }
      }
      setCurrentTime(video.currentTime);
      const hlsPlayingDate = hlsRef.current?.playingDate ?? null;
      if (hlsPlayingDate) {
        setPlayingDate(hlsPlayingDate);
      } else if (seekableRange.length > 0) {
        const rangeStart = seekableRange.start(0);
        const rangeEnd = seekableRange.end(seekableRange.length - 1);
        const requestedStart = streamStartAtRef.current;
        const newest = statusRef.current?.newestSegment ? Date.parse(statusRef.current.newestSegment) : Number.NaN;
        const wallClockMs = requestedStart !== null
          ? requestedStart + Math.max(0, video.currentTime - rangeStart) * 1000
          : Number.isFinite(newest) ? newest - Math.max(0, rangeEnd - video.currentTime) * 1000 : Number.NaN;
        setPlayingDate(Number.isFinite(wallClockMs) ? new Date(wallClockMs) : null);
      }
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
  }, [jogRef, jumpToLive]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (toggleReverse()) {
      return;
    }
    if (video.paused) {
      void video.play().catch(() => {});
    } else {
      // A user pause drops us out of live-follow so the frame stays put.
      setLive(false);
      video.pause();
    }
  }, [setLive, toggleReverse]);

  const handleScrub = useCallback((values: number[]) => {
    const video = videoRef.current;
    if (!video || values.length === 0) {
      return;
    }
    scrubbingRef.current = true;
    const oldestMs = status?.oldestSegment ? Date.parse(status.oldestSegment) : 0;
    const newestMs = status?.newestSegment ? Date.parse(status.newestSegment) : 0;
    if (!(newestMs > oldestMs)) {
      const mediaTime = values[0] / 1000;
      setLive(false);
      setScrubTargetMs(null);
      video.currentTime = mediaTime;
      setCurrentTime(mediaTime);
      return;
    }
    const normalizedValue = (values[0] - oldestMs) / Math.max(1, newestMs - oldestMs);
    const previous = lastScrubHapticValueRef.current;
    if (previous !== null) scrubHapticsRef.current.move(normalizedValue - previous, { value: values[0] });
    lastScrubHapticValueRef.current = normalizedValue;
    setLive(false);
    setScrubTargetMs(values[0]);
    const range = video.seekable;
    if (range.length > 0 && newestMs > 0) {
      const candidate = range.end(range.length - 1) - (newestMs - values[0]) / 1000;
      if (candidate >= range.start(0) && candidate <= range.end(range.length - 1)) {
        video.currentTime = candidate;
        setCurrentTime(candidate);
      }
    }
  }, [setLive, status?.newestSegment, status?.oldestSegment]);

  const commitScrub = useCallback((values: number[]) => {
    const video = videoRef.current;
    scrubbingRef.current = false;
    scrubHapticsRef.current.stop();
    lastScrubHapticValueRef.current = null;
    if (video && values.length > 0) {
      const newestMs = status?.newestSegment ? Date.parse(status.newestSegment) : 0;
      const oldestMs = status?.oldestSegment ? Date.parse(status.oldestSegment) : 0;
      if (!(newestMs > oldestMs)) {
        video.currentTime = values[0] / 1000;
        void video.play().catch(() => {});
        return;
      }
      const range = video.seekable;
      const candidate = range.length > 0 && newestMs > 0
        ? range.end(range.length - 1) - (newestMs - values[0]) / 1000
        : Number.NaN;
      if (range.length > 0 && candidate >= range.start(0) && candidate <= range.end(range.length - 1)) {
        video.currentTime = candidate;
        setScrubTargetMs(null);
        void video.play().catch(() => {});
      } else {
        setStreamStartAt(values[0]);
        setReattachToken((token) => token + 1);
      }
    }
  }, [status?.newestSegment]);

  const oldestMs = status?.oldestSegment ? Date.parse(status.oldestSegment) : Number.NaN;
  const newestMs = status?.newestSegment ? Date.parse(status.newestSegment) : Number.NaN;
  const hasAuthoritativeWindow = Number.isFinite(oldestMs) && Number.isFinite(newestMs) && newestMs > oldestMs;
  const windowSeconds = hasAuthoritativeWindow ? Math.max(1, (newestMs - oldestMs) / 1000) : Math.max(1, seekable.end - seekable.start);
  const selectedWallClockMs = isLive ? newestMs : scrubTargetMs ?? playingDate?.getTime() ?? newestMs;
  const behindLiveSeconds = Number.isFinite(newestMs) && Number.isFinite(selectedWallClockMs) ? Math.max(0, (newestMs - selectedWallClockMs) / 1000) : Math.max(0, seekable.end - currentTime);
  const liveEdgeDate = status?.newestSegment ? new Date(status.newestSegment) : new Date();
  const currentDate = Number.isFinite(selectedWallClockMs) ? new Date(selectedWallClockMs) : playingDate ?? liveEdgeDate;
  const windowStartDate = hasAuthoritativeWindow ? new Date(oldestMs) : new Date(liveEdgeDate.getTime() - windowSeconds * 1000);
  const hasDvr = !DEMO_MODE && streamReady && windowSeconds > LIVE_EDGE_THRESHOLD_SECONDS;
  // While following live the player constantly re-seeks, which fires transient
  // pause/play events; treat live as "playing" so the control icon stays stable.
  const showAsPlaying = isLive || playing || reversing;
  const runningRate = isLive ? 1 : forwardPlaybackRate(jog, behindLiveSeconds);

  const advancedContent = (
    <>
        <CameraEventReport cameraId={cameraId} />

        {!DEMO_MODE ? <CameraSnapshots cameraId={cameraId} hasDvr={hasDvr} state={snapshotState} /> : null}
    </>
  );

  return (
    <section className={classNames("camera-panel", className)}>
      <AdvancedFold advanced={advancedContent}>
      <header className="camera-panel-header">
        <div className="flex items-center gap-2">
          {offline ? <VideoOff className="h-4 w-4 text-rose-300" /> : <Video className="h-4 w-4 text-cyan-300" />}
          <span className="text-sm font-black uppercase text-cyan-200">Outside Camera</span>
        </div>
        <span className="camera-source-badge">{sourceLabel(status)}</span>
      </header>

      <div className="camera-stage">
        {DEMO_MODE ? <img className="camera-video" src={demoAssetUrl("assets/outside-demo.png")} alt="Fictional demo camera scene: front garden, ginger cat and parked car" /> : null}
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
          {DEMO_MODE ? "SAMPLE SCENE" : isLive ? "LIVE" : formatOffset(behindLiveSeconds)}
        </div>

        {offline ? (
          <div className="camera-offline-overlay">
            <VideoOff className="h-8 w-8 text-rose-300" />
            <p className="mt-2 text-sm font-black uppercase text-rose-100">No signal</p>
            <p className="mt-1 text-xs text-neutral-400">Waiting for capture device</p>
          </div>
        ) : null}
      </div>

      {DEMO_MODE ? <p className="px-3 py-2 text-xs text-neutral-400">AI-generated sample scene. Explore event review below; recording and playback require a connected camera.</p> : null}
      <div className={classNames("camera-controls", DEMO_MODE && "hidden")}>
        <button type="button" className="camera-control-button" onClick={togglePlay} aria-label={showAsPlaying ? "Pause" : "Play"}>
          {showAsPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </button>

        <CameraJogDial
          jog={jog}
          runningRate={runningRate}
          playing={showAsPlaying}
          disabled={!streamReady}
          onRateChange={selectRate}
          onToggle={togglePlay}
        />

        <div className="camera-timeline">
          <Slider.Root
            className="camera-slider"
            min={hasAuthoritativeWindow ? oldestMs : seekable.start * 1000}
            max={hasAuthoritativeWindow ? newestMs : seekable.end * 1000}
            value={[hasAuthoritativeWindow
              ? Math.min(Math.max(selectedWallClockMs, oldestMs), newestMs)
              : (isLive ? seekable.end : Math.min(Math.max(currentTime, seekable.start), seekable.end)) * 1000]}
            step={500}
            disabled={!hasDvr}
            onPointerDown={() => {
              if (!hasDvr) return;
              scrubHapticsRef.current.start({
                value: hasAuthoritativeWindow ? selectedWallClockMs : (isLive ? seekable.end : Math.min(Math.max(currentTime, seekable.start), seekable.end)) * 1000,
                step: 500,
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

      </AdvancedFold>

      <CameraSnapshotConfirm state={snapshotState} />
    </section>
  );
}
