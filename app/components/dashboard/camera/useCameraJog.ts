import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { arePageUpdatesPaused } from "../pageUpdatePause";
import { JOG_REVERSE_SEEK_INTERVAL_MS } from "./constants";
import { reverseStep } from "./jog-model";

/**
 * The jog: a rate the owner has set on the dial, or null when none is set and the
 * panel's own playback rules apply. Forward rates are applied by the panel's
 * sample loop; a negative rate is driven from here by seeking, because `<video>`
 * cannot play backwards.
 */
export function useCameraJog({
  videoRef,
  scrubbingRef,
  isLiveRef,
  setLive,
  oldestPosition,
  suspended = false,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  scrubbingRef: RefObject<boolean>;
  isLiveRef: RefObject<boolean>;
  setLive: (live: boolean) => void;
  /** Where reverse must stop, for a recording whose real start is not `seekable`'s. */
  oldestPosition?: () => number;
  /** Off-screen: reverse holds its place and resumes on return. */
  suspended?: boolean;
}) {
  const [jog, setJogState] = useState<number | null>(null);
  const [reverseRunning, setReverseRunningState] = useState(false);
  const jogRef = useRef<number | null>(null);
  const reverseRunningRef = useRef(false);

  const setJog = useCallback((rate: number | null) => {
    jogRef.current = rate;
    setJogState(rate);
  }, []);

  const setReverseRunning = useCallback((running: boolean) => {
    reverseRunningRef.current = running;
    setReverseRunningState(running);
  }, []);

  /** The dial landed on a stop. Playing stays playing and paused stays paused. */
  const selectRate = useCallback((rate: number) => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const wasReverse = jogRef.current !== null && jogRef.current < 0;
    const moving = isLiveRef.current || (wasReverse ? reverseRunningRef.current : !video.paused);
    setLive(false);
    setJog(rate);
    if (rate < 0) {
      setReverseRunning(moving);
      video.pause();
      return;
    }
    setReverseRunning(false);
    video.playbackRate = rate;
    if (wasReverse && moving) {
      void video.play().catch(() => {});
    }
  }, [isLiveRef, setJog, setLive, setReverseRunning, videoRef]);

  const clearJog = useCallback(() => {
    setJog(null);
    setReverseRunning(false);
  }, [setJog, setReverseRunning]);

  /** Play/pause while reversing. False when the jog is not negative: not ours to handle. */
  const toggleReverse = useCallback(() => {
    if (jogRef.current === null || jogRef.current >= 0) {
      return false;
    }
    setReverseRunning(!reverseRunningRef.current);
    return true;
  }, [setReverseRunning]);

  const reversing = jog !== null && jog < 0 && reverseRunning;

  useEffect(() => {
    const video = videoRef.current;
    if (!reversing || suspended || !video) {
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // The refs change before React removes this loop. One more pass here would
      // pause the play() that selectRate has just called.
      if (!reverseRunningRef.current || jogRef.current === null || jogRef.current >= 0) {
        return;
      }
      if (scrubbingRef.current || arePageUpdatesPaused()) {
        last = now;
        return;
      }
      // Anything that restarts the element (a scrub's commit, a re-attach) is undone here.
      if (!video.paused) video.pause();
      if (video.seeking || now - last < JOG_REVERSE_SEEK_INTERVAL_MS) {
        return;
      }
      const range = video.seekable;
      if (range.length === 0) {
        last = now;
        return;
      }
      const step = reverseStep(video.currentTime, jogRef.current, (now - last) / 1000, oldestPosition?.() ?? range.start(0));
      last = now;
      video.currentTime = step.time;
      if (step.atStart) setReverseRunning(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [oldestPosition, reversing, scrubbingRef, setReverseRunning, suspended, videoRef]);

  return { jog, jogRef, reversing, selectRate, clearJog, toggleReverse };
}
