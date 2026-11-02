import { useEffect, useRef, useState, type RefObject } from "react";
import {
  LIVE_TARGET_LATENCY_SECONDS,
  SMOOTH_HANDOFF_TIMEOUT_MS,
  SMOOTH_RETRY_AFTER_MS,
  SMOOTH_STALL_MS,
  SMOOTH_START_TIMEOUT_MS,
} from "./constants";
import { prefersNativeHls } from "./hls-engine-model";
import type { Hls } from "./types";

/**
 * Plays the 60 fps stream in its own `<video>` while it is wanted, and says when it
 * should be shown: only once it is actually playing. Any failure falls back to the
 * recording and tries again later. specs/camera-smooth-delivery.md.
 */
export function useSmoothLive({
  cameraId,
  wanted,
  smoothRef,
  mainVideoRef,
  mainHlsRef,
  scrubbingRef,
}: {
  cameraId: string;
  wanted: boolean;
  smoothRef: RefObject<HTMLVideoElement | null>;
  mainVideoRef: RefObject<HTMLVideoElement | null>;
  mainHlsRef: RefObject<Hls | null>;
  scrubbingRef: RefObject<boolean>;
}) {
  const [showing, setShowing] = useState(false);
  const [resting, setResting] = useState(false);
  const [attached, setAttached] = useState(false);
  const smoothHlsRef = useRef<Hls | null>(null);
  const mainStoppedRef = useRef(false);

  const playing = wanted && !resting;

  const resumeMain = useRef(() => {});
  resumeMain.current = () => {
    if (mainStoppedRef.current) {
      mainStoppedRef.current = false;
      mainHlsRef.current?.startLoad();
    }
  };

  // Attach while wanted. Detaching waits for the handoff below, so the picture does
  // not drop back to a recording that stopped loading a while ago.
  useEffect(() => {
    const video = smoothRef.current;
    if (!playing || !video) {
      return;
    }
    let cancelled = false;
    const src = `/api/camera-proxy/${encodeURIComponent(cameraId)}/smooth/index.m3u8`;
    let lastTime = -1;
    let lastMoved = performance.now();
    const startedAt = performance.now();
    let started = false;

    const fail = () => {
      if (cancelled) return;
      setShowing(false);
      setAttached(false);
      setResting(true);
    };
    const onPlaying = () => {
      started = true;
      lastMoved = performance.now();
      setShowing(true);
    };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", fail);

    const watchdog = window.setInterval(() => {
      const now = performance.now();
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        lastMoved = now;
      }
      if (started ? now - lastMoved > SMOOTH_STALL_MS : now - startedAt > SMOOTH_START_TIMEOUT_MS) {
        fail();
      }
    }, 500);

    setAttached(true);
    void (async () => {
      if (prefersNativeHls(video.canPlayType("application/vnd.apple.mpegurl"), navigator.userAgent)) {
        // WebKit does not retry a 503 playlist, so wait out the pipeline's start here.
        while (!cancelled && !(await fetch(src, { cache: "no-store" }).then((r) => r.ok, () => false))) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
        }
        if (cancelled) return;
        video.src = src;
      } else {
        const { default: HlsLib } = await import("hls.js");
        if (cancelled) return;
        if (!HlsLib.isSupported()) {
          fail();
          return;
        }
        // Pressing Live during a handoff comes back here with the last one still attached.
        smoothHlsRef.current?.destroy();
        const hls = new HlsLib({
          lowLatencyMode: false,
          liveSyncDurationCount: 2,
          maxBufferLength: 4,
          backBufferLength: 0,
          // The first requests get a 503 while the service starts its pipeline.
          manifestLoadingMaxRetry: 25,
          manifestLoadingRetryDelay: 1000,
          manifestLoadingMaxRetryTimeout: 1000,
        });
        smoothHlsRef.current = hls;
        hls.on(HlsLib.Events.ERROR, (_event, data) => {
          if (data.fatal) fail();
        });
        hls.loadSource(src);
        hls.attachMedia(video);
      }
      void video.play().catch(() => {});
    })();

    return () => {
      cancelled = true;
      window.clearInterval(watchdog);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", fail);
    };
  }, [cameraId, playing, smoothRef]);

  // No longer wanted, or failed: release the stream.
  const release = useRef(() => {});
  release.current = () => {
    smoothHlsRef.current?.destroy();
    smoothHlsRef.current = null;
    const video = smoothRef.current;
    if (video) {
      video.removeAttribute("src");
      video.load();
    }
    setShowing(false);
    setAttached(false);
  };

  // While the smooth stream is on screen the recording stops loading. Leaving it, the
  // recording resumes and catches up, under the smooth stream's last frame.
  useEffect(() => {
    if (playing) {
      if (showing && mainHlsRef.current) {
        mainHlsRef.current.stopLoad();
        mainStoppedRef.current = true;
      }
      return;
    }
    if (!attached && !showing) {
      return;
    }
    if (!showing) {
      release.current();
      return;
    }
    smoothRef.current?.pause();
    resumeMain.current();
    const main = mainVideoRef.current;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      main?.removeEventListener("seeked", finish);
      release.current();
    };
    // A scrub has its own position to show, straight away.
    if (!main || scrubbingRef.current) {
      finish();
      return;
    }
    const catchUp = () => {
      if (done) return;
      const range = main.seekable;
      if (range.length === 0) return;
      const end = range.end(range.length - 1);
      if (end - main.currentTime > LIVE_TARGET_LATENCY_SECONDS + 2 && !scrubbingRef.current) {
        main.addEventListener("seeked", finish);
        main.currentTime = end - LIVE_TARGET_LATENCY_SECONDS;
      } else {
        finish();
      }
    };
    // Wait for a playlist refresh: the seekable range is stale until then.
    const refresh = window.setTimeout(catchUp, 600);
    const timeout = window.setTimeout(finish, SMOOTH_HANDOFF_TIMEOUT_MS);
    return () => {
      window.clearTimeout(refresh);
      window.clearTimeout(timeout);
      main?.removeEventListener("seeked", finish);
    };
  }, [attached, mainHlsRef, mainVideoRef, playing, scrubbingRef, showing, smoothRef]);

  // After a failure, wait before trying again.
  useEffect(() => {
    if (!resting) {
      return;
    }
    resumeMain.current();
    release.current();
    const timer = window.setTimeout(() => setResting(false), SMOOTH_RETRY_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [resting]);

  useEffect(() => () => {
    smoothHlsRef.current?.destroy();
    smoothHlsRef.current = null;
  }, []);

  return { showing };
}
