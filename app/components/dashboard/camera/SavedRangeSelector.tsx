"use client";

import * as Slider from "@radix-ui/react-slider";
import { Loader2, Pause, Play, Save, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cameraUrl } from "../cameraHost";
import { formatClock, formatDuration } from "./format-model";
import { prefersNativeHls } from "./hls-engine-model";
import type { Hls } from "./types";

const DEFAULT_SELECTION_MS = 60_000;
const MIN_SELECTION_MS = 2_000;
const SELECTION_STEP_MS = 1_000;

/**
 * Choosing a range out of the DVR window: two thumbs and a preview of the recording.
 * Dragging a thumb shows that moment; play runs the selection on a loop.
 */
export function SavedRangeSelector({
  cameraId,
  oldestMs,
  newestMs,
  busy,
  onSave,
  onCancel,
}: {
  cameraId: string;
  oldestMs: number;
  newestMs: number;
  busy: boolean;
  onSave: (startMs: number, endMs: number) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  // The window keeps moving; the selection is chosen against where it stood on opening.
  const [bounds] = useState({ min: oldestMs, max: newestMs });
  const [selection, setSelection] = useState<[number, number]>([Math.max(oldestMs, newestMs - DEFAULT_SELECTION_MS), newestMs]);
  const [previewing, setPreviewing] = useState(false);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const newestRef = useRef(newestMs);
  newestRef.current = newestMs;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    let cancelled = false;
    let hls: Hls | null = null;
    const src = cameraUrl(cameraId, "index.m3u8");
    void (async () => {
      if (prefersNativeHls(video.canPlayType("application/vnd.apple.mpegurl"), navigator.userAgent)) {
        video.src = src;
        return;
      }
      const { default: HlsLib } = await import("hls.js");
      if (cancelled || !HlsLib.isSupported()) return;
      hls = new HlsLib({ backBufferLength: 30, maxBufferLength: 10, startPosition: 0 });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
    })();
    return () => {
      cancelled = true;
      hlsRef.current = null;
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [cameraId]);

  /**
   * The recording's time for a moment. hls.js knows each fragment's own clock; WebKit's
   * engine does not say, so there it is measured back from the newest footage, which is
   * only as fresh as the last status poll.
   */
  const mediaTime = useCallback((video: HTMLVideoElement, wallClockMs: number) => {
    const range = video.seekable;
    if (range.length === 0) return null;
    const fragments = hlsRef.current?.levels?.[0]?.details?.fragments;
    const anchor = fragments?.find((fragment) => typeof fragment.programDateTime === "number");
    const time = anchor?.programDateTime
      ? anchor.start + (wallClockMs - anchor.programDateTime) / 1000
      : range.end(range.length - 1) - (newestRef.current - wallClockMs) / 1000;
    return Math.max(range.start(0), Math.min(time, range.end(range.length - 1)));
  }, []);

  const seekTo = useCallback((wallClockMs: number) => {
    const video = videoRef.current;
    if (!video) return;
    const time = mediaTime(video, wallClockMs);
    if (time !== null) video.currentTime = time;
  }, [mediaTime]);

  // Show the selection's start once the recording can seek there.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const show = () => {
      video.pause();
      seekTo(selectionRef.current[0]);
    };
    video.addEventListener("loadedmetadata", show, { once: true });
    return () => video.removeEventListener("loadedmetadata", show);
  }, [seekTo]);

  // While previewing, loop inside the selection.
  useEffect(() => {
    if (!previewing) {
      return;
    }
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const timer = window.setInterval(() => {
      const end = mediaTime(video, selectionRef.current[1]);
      if (end !== null && video.currentTime >= end) seekTo(selectionRef.current[0]);
    }, 100);
    return () => window.clearInterval(timer);
  }, [mediaTime, previewing, seekTo]);

  const togglePreview = () => {
    const video = videoRef.current;
    if (!video) return;
    if (previewing) {
      video.pause();
      setPreviewing(false);
      return;
    }
    seekTo(selection[0]);
    void video.play().catch(() => {});
    setPreviewing(true);
  };

  const onDrag = (values: number[]) => {
    const [start, end] = values;
    const moved = start !== selection[0] ? start : end;
    setSelection([start, end]);
    videoRef.current?.pause();
    setPreviewing(false);
    seekTo(moved);
  };

  const [start, end] = selection;
  return (
    <div className="saved-range-selector">
      <div className="camera-stage">
        <video ref={videoRef} className="camera-video" playsInline muted />
      </div>
      <div className="camera-controls">
        <button type="button" className="camera-control-button" onClick={togglePreview} aria-label={previewing ? "Pause preview" : "Play preview"}>
          {previewing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </button>
        <div className="camera-timeline">
          <Slider.Root
            className="camera-slider"
            min={bounds.min}
            max={bounds.max}
            step={SELECTION_STEP_MS}
            minStepsBetweenThumbs={MIN_SELECTION_MS / SELECTION_STEP_MS}
            value={selection}
            onValueChange={onDrag}
          >
            <Slider.Track className="camera-slider-track">
              <Slider.Range className="camera-slider-range" />
            </Slider.Track>
            <Slider.Thumb className="camera-slider-thumb" aria-label="Range start" />
            <Slider.Thumb className="camera-slider-thumb" aria-label="Range end" />
          </Slider.Root>
          <div className="camera-timeline-labels">
            <span>{formatClock(new Date(start))}</span>
            <span className="camera-timeline-current">{formatDuration((end - start) / 1000)}</span>
            <span>{formatClock(new Date(end))}</span>
          </div>
        </div>
      </div>
      <div className="saved-range-actions">
        <button type="button" className="saved-range-button" disabled={busy} onClick={() => onSave(start, end)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
          Save
        </button>
        <button type="button" className="saved-range-button" onClick={onCancel}>
          <X className="h-4 w-4" aria-hidden="true" />
          Cancel
        </button>
      </div>
    </div>
  );
}
