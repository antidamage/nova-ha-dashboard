"use client";

import { useEffect, useRef, useState } from "react";
import { cameraUrl } from "../../dashboard/cameraHost";
import type { CameraStatus, Processing } from "./types";

// The two things that watch the feed rather than configure it: the 5s recorder
// status poll and the HLS (or native Safari) preview attached to the <video>.
export function useCameraPreview({
  saved,
  setMessage,
  videoHostUrl,
}: {
  saved: Processing;
  setMessage: (message: string) => void;
  videoHostUrl: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<CameraStatus | null>(null);

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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    let destroy: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const onPlaying = () => setMessage("Live preview");
    video.addEventListener("playing", onPlaying);

    // Safari/WebKit's native HLS engine is more reliable than its partial MSE
    // implementation. Select it before importing hls.js; recent iOS versions
    // can otherwise pass Hls.isSupported() and then never request the manifest.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = `${cameraUrl("outside", "index.m3u8", videoHostUrl)}?preview=${Date.now()}`;
      void video.play().catch(() => undefined);
      destroy = () => {
        video.removeAttribute("src");
        video.load();
      };
      return () => {
        disposed = true;
        video.removeEventListener("playing", onPlaying);
        destroy?.();
      };
    }

    void import("hls.js").then(({ default: Hls }) => {
      if (disposed) return;
      if (!Hls.isSupported()) return;

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

  return { status, videoRef };
}
