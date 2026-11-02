import { useEffect, useState, type RefObject } from "react";
import { SMOOTH_RETRY_AFTER_MS, SMOOTH_STALL_MS } from "./constants";
import {
  handoffFragment,
  SMOOTH_CORRECTION_INTERVAL_MS,
  SMOOTH_GIVE_UP_DRIFT_SECONDS,
  SMOOTH_MAX_DRIFT_SECONDS,
  SMOOTH_MISSED_HANDOFF_SECONDS,
  smoothStreamTime,
  type SmoothRate,
} from "./smooth-position-model";
import type { Hls } from "./types";

const WATCH_INTERVAL_MS = 100;

type Fragment = { start: number; programDateTime?: number | null };

/**
 * Plays a 60 fps stream over the recording, from a position rather than live. The
 * recording keeps playing underneath and stays the truth: pausing, scrubbing or changing
 * rate hides this at once and the recording is already in the right place. The stream
 * starts ahead of the recording and is shown when the recording reaches its first frame,
 * so nothing jumps. Needs hls.js on the recording to read its fragments; on WebKit's
 * native engine the recording shows. specs/camera-smooth-delivery.md.
 */
export function useSmoothPosition({
  rate,
  baseVideoRef,
  baseHlsRef,
  overlayRef,
  streamPath,
}: {
  /** The rate to smooth at, or null when this should not be running. */
  rate: SmoothRate | null;
  baseVideoRef: RefObject<HTMLVideoElement | null>;
  baseHlsRef: RefObject<Hls | null>;
  overlayRef: RefObject<HTMLVideoElement | null>;
  /** The stream's path under the camera proxy for a chosen fragment, or null if it has no address. */
  streamPath: (fragment: Fragment, rate: SmoothRate) => string | null;
}) {
  const [showing, setShowing] = useState(false);
  const [resting, setResting] = useState(false);

  useEffect(() => {
    const base = baseVideoRef.current;
    const overlay = overlayRef.current;
    if (rate === null || resting || !base || !overlay) {
      return;
    }
    let cancelled = false;
    let hls: Hls | null = null;
    let handoff: Fragment | null = null;
    let lastTime = -1;
    let lastMoved = 0;
    let lastCorrected = 0;
    let started = false;

    const stop = () => {
      hls?.destroy();
      hls = null;
      overlay.removeAttribute("src");
      overlay.load();
      setShowing(false);
    };
    const fail = () => {
      if (cancelled) return;
      cancelled = true;
      window.clearInterval(watch);
      stop();
      setResting(true);
    };

    const begin = async (fragment: Fragment, path: string) => {
      const { default: HlsLib } = await import("hls.js");
      if (cancelled) return;
      if (!HlsLib.isSupported()) {
        fail();
        return;
      }
      hls = new HlsLib({
        startPosition: 0,
        lowLatencyMode: false,
        maxBufferLength: 6,
        backBufferLength: 0,
        // The first requests get a 503 while the service starts its pipeline.
        manifestLoadingMaxRetry: 25,
        manifestLoadingRetryDelay: 1000,
        manifestLoadingMaxRetryTimeout: 1000,
      });
      hls.on(HlsLib.Events.ERROR, (_event, data) => {
        if (data.fatal) fail();
      });
      handoff = fragment;
      hls.loadSource(path);
      hls.attachMedia(overlay);
    };

    const follow = () => {
      if (!handoff || !hls) return;
      const details = hls.levels?.[0]?.details;
      const first = details?.fragments?.[0];
      if (!first || typeof first.sn !== "number") {
        if (base.currentTime > handoff.start + SMOOTH_MISSED_HANDOFF_SECONDS) fail();
        return;
      }
      if (base.currentTime < handoff.start) return;
      const target = smoothStreamTime(base.currentTime, handoff.start, rate, first.sn, first.start);
      const ready = overlay.readyState >= 2;
      if (!started) {
        if (!ready) {
          if (base.currentTime > handoff.start + SMOOTH_MISSED_HANDOFF_SECONDS) fail();
          return;
        }
        started = true;
        lastMoved = performance.now();
        overlay.currentTime = target;
        void overlay.play().catch(() => {});
        return;
      }
      if (overlay.seeking) return;
      const drift = target - overlay.currentTime;
      // The stream has fallen too far behind to be showing the same moment.
      if (drift > SMOOTH_GIVE_UP_DRIFT_SECONDS) {
        fail();
        return;
      }
      if (Math.abs(drift) > SMOOTH_MAX_DRIFT_SECONDS && performance.now() - lastCorrected > SMOOTH_CORRECTION_INTERVAL_MS) {
        const buffered = overlay.buffered;
        // Seeking past what has arrived only stalls it further.
        if (buffered.length > 0 && target < buffered.end(buffered.length - 1)) {
          lastCorrected = performance.now();
          overlay.currentTime = target;
        }
      }
      if (overlay.currentTime !== lastTime) {
        lastTime = overlay.currentTime;
        lastMoved = performance.now();
      } else if (performance.now() - lastMoved > SMOOTH_STALL_MS) {
        fail();
      }
    };

    const onPlaying = () => {
      if (!cancelled) setShowing(true);
    };
    overlay.addEventListener("playing", onPlaying);

    const watch = window.setInterval(() => {
      if (cancelled) return;
      if (hls) {
        follow();
        return;
      }
      if (handoff) return;
      const fragments = baseHlsRef.current?.levels?.[0]?.details?.fragments as Fragment[] | undefined;
      if (!fragments) return;
      const fragment = handoffFragment(fragments, base.currentTime, rate);
      const path = fragment && streamPath(fragment, rate);
      if (!fragment || !path) return;
      handoff = fragment;
      void begin(fragment, path).catch(fail);
    }, WATCH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(watch);
      overlay.removeEventListener("playing", onPlaying);
      stop();
    };
  }, [baseHlsRef, baseVideoRef, overlayRef, rate, resting, streamPath]);

  useEffect(() => {
    if (!resting) {
      return;
    }
    const timer = window.setTimeout(() => setResting(false), SMOOTH_RETRY_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [resting]);

  return { showing };
}
