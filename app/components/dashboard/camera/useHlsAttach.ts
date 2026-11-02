import { useEffect, type RefObject } from "react";
import { cameraUrl } from "../cameraHost";
import { DEMO_MODE, LIVE_SYNC_MAX_RATE } from "./constants";
import { prefersNativeHls } from "./hls-engine-model";
import type { Hls } from "./types";

/** Attaches the recording's HLS stream to the panel's `<video>`. */
export function useHlsAttach({
  cameraId,
  videoRef,
  hlsRef,
  reattachToken,
  streamStartAt,
  setLive,
  setStreamReady,
  setPlayingDate,
  setScrubTargetMs,
}: {
  cameraId: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  hlsRef: RefObject<Hls | null>;
  reattachToken: number;
  streamStartAt: number | null;
  setLive: (live: boolean) => void;
  setStreamReady: (ready: boolean) => void;
  setPlayingDate: (date: Date | null) => void;
  setScrubTargetMs: (ms: number | null) => void;
}) {
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
  }, [cameraId, hlsRef, reattachToken, setLive, setPlayingDate, setScrubTargetMs, setStreamReady, streamStartAt, videoRef]);
}
