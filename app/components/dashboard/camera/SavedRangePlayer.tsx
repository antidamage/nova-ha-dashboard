"use client";

import * as Slider from "@radix-ui/react-slider";
import type { HlsConfig } from "hls.js";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedRangeSummary } from "../../../../lib/camera/saved-ranges-model";
import { classNames } from "../shared";
import { CameraJogDial } from "./CameraJogDial";
import { DEMO_MODE } from "./constants";
import { formatClock } from "./format-model";
import { prefersNativeHls } from "./hls-engine-model";
import { JOG_DEFAULT_RATE } from "./jog-model";
import { smoothRateFor, type SmoothRate } from "./smooth-position-model";
import type { Hls } from "./types";
import { useCameraJog } from "./useCameraJog";
import { useOnScreen } from "./useOnScreen";
import { useSmoothPosition } from "./useSmoothPosition";
import { useSuspendOffScreen } from "./useSuspendOffScreen";

const noLive = () => {};

/** A saved range's player: the main panel's controls, with no live edge. */
export function SavedRangePlayer({ cameraId, range, onClose }: { cameraId: string; range: SavedRangeSummary; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(stageRef);
  const scrubbingRef = useRef(false);
  const isLiveRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(range.durationSeconds);

  const { jog, jogRef, reversing, selectRate, toggleReverse } = useCameraJog({ videoRef, scrubbingRef, isLiveRef, setLive: noLive, suspended: !onScreen });
  const runningRate = jog ?? JOG_DEFAULT_RATE;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    let cancelled = false;
    const src = `/api/camera/${encodeURIComponent(cameraId)}/saved/${range.id}/index.m3u8`;
    const onMetadata = () => setReady(true);
    video.addEventListener("loadedmetadata", onMetadata);
    void (async () => {
      if (!DEMO_MODE && prefersNativeHls(video.canPlayType("application/vnd.apple.mpegurl"), navigator.userAgent)) {
        video.src = src;
      } else {
        const { default: HlsLib, FetchLoader } = await import("hls.js");
        if (cancelled || !HlsLib.isSupported()) return;
        // The demo's playlists come from its fetch shim, as on the main player.
        const hls = new HlsLib({ backBufferLength: 30, maxBufferLength: 30, ...(DEMO_MODE ? { pLoader: FetchLoader as unknown as HlsConfig["pLoader"] } : {}) });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);
      }
      void video.play().catch(() => {});
    })();
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", onMetadata);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [cameraId, range.id]);

  useSuspendOffScreen({ onScreen, videoRef, hlsRef });

  // Follow the element. A jog's forward rate is applied here; its reverse is useCameraJog's.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    let raf = 0;
    const sample = () => {
      raf = requestAnimationFrame(sample);
      setCurrentTime(video.currentTime);
      if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
      const rate = jogRef.current ?? JOG_DEFAULT_RATE;
      if (rate > 0 && Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;
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
  }, [jogRef]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || toggleReverse()) {
      return;
    }
    if (video.paused) {
      if (video.ended) video.currentTime = 0;
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [toggleReverse]);

  const streamPath = useCallback((fragment: { start: number }, rate: SmoothRate) => {
    return `/api/camera-proxy/${encodeURIComponent(cameraId)}/smooth/at/${range.id}/${Math.round(fragment.start * 1000)}/${rate}/index.m3u8`;
  }, [cameraId, range.id]);

  const { showing } = useSmoothPosition({
    rate: onScreen && playing && !scrubbing ? smoothRateFor(runningRate) : null,
    baseVideoRef: videoRef,
    baseHlsRef: hlsRef,
    overlayRef,
    streamPath,
  });

  const showAsPlaying = playing || reversing;
  const clockAt = (seconds: number) => formatClock(new Date(range.startMs + seconds * 1000));
  return (
    <div className="saved-range-player">
      <div ref={stageRef} className="camera-stage">
        <video ref={videoRef} className="camera-video" playsInline muted />
        <video ref={overlayRef} className={classNames("camera-video", !showing && "opacity-0")} playsInline muted aria-hidden={!showing} />
        {showing ? <div className="camera-live-pill is-rewound"><span className="camera-live-dot" />60</div> : null}
      </div>
      <div className="camera-controls">
        <CameraJogDial jog={jog} runningRate={runningRate} playing={showAsPlaying} disabled={!ready} onRateChange={selectRate} onToggle={togglePlay} />
        <div className="camera-timeline">
          <Slider.Root
            className="camera-slider"
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.1}
            value={[Math.min(currentTime, duration)]}
            disabled={!ready}
            onValueChange={(values) => {
              const video = videoRef.current;
              if (!video) return;
              scrubbingRef.current = true;
              setScrubbing(true);
              video.currentTime = values[0];
            }}
            onValueCommit={() => {
              scrubbingRef.current = false;
              setScrubbing(false);
            }}
          >
            <Slider.Track className="camera-slider-track">
              <Slider.Range className="camera-slider-range" />
            </Slider.Track>
            <Slider.Thumb className="camera-slider-thumb" aria-label="Scrub saved range" />
          </Slider.Root>
          <div className="camera-timeline-labels">
            <span>{clockAt(0)}</span>
            <span className="camera-timeline-current">{clockAt(currentTime)}</span>
            <span>{clockAt(duration)}</span>
          </div>
        </div>
        <button type="button" className="camera-control-button" onClick={onClose} aria-label="Close player">
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
