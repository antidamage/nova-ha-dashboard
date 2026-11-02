import { useEffect, useRef, type RefObject } from "react";
import type { Hls } from "./types";

/**
 * Stops a recording's video and its downloading while it is off-screen, and picks both
 * up as they were on return. Paused stays paused; a jog's reverse is stopped by the jog.
 */
export function useSuspendOffScreen({
  onScreen,
  videoRef,
  hlsRef,
}: {
  onScreen: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  hlsRef: RefObject<Hls | null>;
}) {
  const suspendedRef = useRef(false);
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (!onScreen) {
      if (!suspendedRef.current) {
        suspendedRef.current = true;
        wasPlayingRef.current = !video.paused;
      }
      video.pause();
      hlsRef.current?.stopLoad();
      return;
    }
    if (suspendedRef.current) {
      suspendedRef.current = false;
      hlsRef.current?.startLoad();
      if (wasPlayingRef.current) void video.play().catch(() => {});
    }
  }, [hlsRef, onScreen, videoRef]);
}
