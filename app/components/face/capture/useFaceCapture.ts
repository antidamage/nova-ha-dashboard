"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CAMERA_BUSY_RETRIES, CAMERA_BUSY_RETRY_MS, DEFAULT_CAPTURE, FACE_REASON_MESSAGES, STREAM_FATAL_REASONS } from "./constants";
import { pickPreferredCamera, preferredClipMimeType, readJsonBody } from "./capture-model";
import { loadCameraPreferences } from "./store";
import type { CameraChoice, CaptureSpec, FaceCapture, StreamResult } from "./types";

/** Resolve on the next decoded video frame, or after `timeoutMs` without one. */
function nextVideoFrame(video: HTMLVideoElement, timeoutMs = 250): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, timeoutMs);
    const withCallback = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
    };
    if (typeof withCallback.requestVideoFrameCallback === "function") {
      withCallback.requestVideoFrameCallback(() => {
        window.clearTimeout(timer);
        resolve();
      });
    }
  });
}

/**
 * The camera lifecycle, shared by enrolment and by face login.
 *
 * Returns error *messages* rather than setting status itself, because the two
 * consumers present failures differently — enrolment has a toned status line,
 * the login modal has its own error slot — and a hook that owned the
 * presentation would force one of them into the other's shape.
 */
export function useFaceCapture(spec: CaptureSpec = DEFAULT_CAPTURE): FaceCapture {
  const [secureContext, setSecureContext] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<CameraChoice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [previewing, setPreviewing] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const clipTimerRef = useRef<number | null>(null);

  /**
   * Release the camera.
   *
   * Called on unmount, when a containing section collapses, when the device
   * changes, and once the final clip lands. A camera light left on in someone's
   * house is a real bug.
   */
  const stopStream = useCallback(() => {
    if (clipTimerRef.current !== null) {
      window.clearTimeout(clipTimerRef.current);
      clipTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // A recorder torn down mid-clip is expected during unmount.
      }
    }
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setPreviewing(false);
  }, []);

  useEffect(() => {
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    setSecureContext(
      typeof window !== "undefined"
        && window.isSecureContext === true
        && typeof media?.getUserMedia === "function",
    );
  }, []);

  // Unmount must release the camera even if the consumer forgets.
  useEffect(() => stopStream, [stopStream]);

  const openCameraAttempt = useCallback(async (requestedId?: string, attempt = 0): Promise<string | null> => {
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (typeof media?.getUserMedia !== "function") {
      return FACE_REASON_MESSAGES.insecure_context;
    }
    stopStream();
    try {
      let target = requestedId ?? deviceId;
      let listed: CameraChoice[] = (await media.enumerateDevices())
        .filter((device) => device.kind === "videoinput")
        .map((device) => ({ deviceId: device.deviceId, label: device.label }));

      // Labels are blank until the page holds a camera permission, and without
      // labels the grabber and the webcam are indistinguishable. So when the
      // list is unlabelled, take a permission grant first and stop it again
      // BEFORE binding a preview — the probe may land on whatever the browser
      // considers default, and that stream must not be the one we record from.
      if (!target && listed.every((device) => !device.label)) {
        const probe = await media.getUserMedia({ video: true });
        probe.getTracks().forEach((track) => track.stop());
        listed = (await media.enumerateDevices())
          .filter((device) => device.kind === "videoinput")
          .map((device) => ({ deviceId: device.deviceId, label: device.label }));
      }
      setDevices(listed);
      if (!target) {
        target = pickPreferredCamera(listed, await loadCameraPreferences())?.deviceId ?? "";
      }
      setDeviceId(target);

      const stream = await media.getUserMedia({
        video: {
          ...(target ? { deviceId: { exact: target } } : {}),
          width: 1280,
          height: 720,
          facingMode: "user",
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Wrapped rather than awaited directly: `play()` is absent in jsdom and
        // returns undefined in older Safari, so calling `.catch` on its result
        // is a TypeError that would look like a camera failure.
        await Promise.resolve(videoRef.current.play?.()).catch(() => undefined);
      }
      setPreviewing(true);
      return null;
    } catch (error) {
      stopStream();
      if (error instanceof Error && error.name === "NotAllowedError") {
        return "Camera permission was refused for this page.";
      }
      // The device is momentarily held by something else, and on the kiosk that
      // something else is usually the witness daemon: it grabs the same webcam
      // for about a second whenever somebody touches the panel, which is
      // exactly what tapping "Use Face" is. A second attempt then failed with
      // "the camera could not be opened" and there was no way back without
      // leaving the sign-in entirely.
      //
      // Retrying beats coordinating across two processes, and it covers every
      // other transient holder as well.
      if (attempt < CAMERA_BUSY_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, CAMERA_BUSY_RETRY_MS));
        return openCameraAttempt(requestedId, attempt + 1);
      }
      return "The camera is in use. Wait a moment and try again.";
    }
  }, [deviceId, stopStream]);

  const openCamera = useCallback(
    (requestedId?: string) => openCameraAttempt(requestedId),
    [openCameraAttempt],
  );

  /**
   * A single frame out of the live preview, as JPEG.
   *
   * Drawn from the `<video>` element rather than taken with `ImageCapture`:
   * `ImageCapture` is absent in Safari and behind a flag in Firefox, and the
   * preview is already the frame the person is looking at. 0.92 quality because
   * the service scores real texture — anti-spoof is off on this path, but
   * detection and the embedding are not, and JPEG ringing at low quality moves
   * an embedding for no saving worth having.
   */
  const captureStill = useCallback(async (): Promise<Blob> => {
    const video = videoRef.current;
    if (!video || !streamRef.current) throw new Error("The camera is not running.");
    const width = video.videoWidth;
    const height = video.videoHeight;
    // A preview that has not produced a frame yet has zero dimensions, and a
    // 0x0 canvas encodes to a blob the service can only answer "no face" to.
    if (!width || !height) throw new Error("The camera is not ready yet.");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The clip could not be recorded.");
    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });
    if (!blob) throw new Error("The clip could not be recorded.");
    return blob;
  }, []);

  /**
   * Post stills to `/api/face/frame` until the service holds enough good ones.
   *
   * There is no clip and no fixed length. Each still goes as soon as the
   * previous answer lands, so a camera that delivers four frames a second is
   * simply slower to get there rather than refused for it — the clip-length and
   * frame-rate gates were what made a sign-in from a modest webcam impossible.
   * Stills the service skips (no face, too small, out of focus) cost only
   * another loop, which is also what gives a kiosk camera time to find focus.
   *
   * The clock starts at the preview's FIRST frame, not at the call: waiting for
   * the camera to hand over a frame is not time spent trying.
   */
  const streamFrames = useCallback(async (nonce: string): Promise<StreamResult> => {
    const giveUpMs = spec.streamGiveUpMs ?? 0;
    const video = videoRef.current;
    if (!giveUpMs || !video || !streamRef.current) {
      throw new Error("The camera is not running.");
    }
    // The preview has no frame yet for the first moments after getUserMedia.
    const readyBy = Date.now() + giveUpMs;
    while (!video.videoWidth || !video.videoHeight) {
      if (Date.now() > readyBy) return { complete: false, reason: null };
      await nextVideoFrame(video, 50);
    }

    const deadline = Date.now() + giveUpMs;
    let lastReason: string | null = null;
    while (Date.now() < deadline) {
      const form = new FormData();
      form.set("image", await captureStill(), "frame.jpg");
      form.set("nonce", nonce);
      const response = await fetch("/api/face/frame", { method: "POST", body: form });
      const body = await readJsonBody(response);
      if (!streamRef.current) return { complete: false, reason: null };
      const reason = typeof body?.reason === "string" ? body.reason : null;
      if (!response.ok) {
        // A refusal that ends the attempt is reported; anything else (a spent
        // frame budget, an unreadable still) falls through to `/assert`, which
        // names what was actually wrong with the frames it has.
        return { complete: false, reason: reason && STREAM_FATAL_REASONS.has(reason) ? reason : null };
      }
      if (body?.complete === true) return { complete: true, reason: null };
      lastReason = reason ?? lastReason;
      // Never post the same decoded frame twice: on a slow camera the preview
      // may not have advanced since the last still, and two copies of one frame
      // are not two frames.
      await nextVideoFrame(video);
    }
    return { complete: false, reason: null };
  }, [captureStill, spec.streamGiveUpMs]);

  const recordClip = useCallback(async (): Promise<{ blob: Blob; field: "clip" | "image" }> => {
    if (spec.streamGiveUpMs) {
      throw new Error("A streamed profile posts stills to /api/face/frame; call streamFrames.");
    }
    if (spec.profile === "image") {
      return { blob: await captureStill(), field: "image" };
    }
    const stream = streamRef.current;
    if (!stream) throw new Error("The camera is not running.");
    const mimeType = preferredClipMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    const chunks: Blob[] = [];
    const finished = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType ?? "video/webm" }));
      recorder.onerror = () => reject(new Error("The clip could not be recorded."));
    });
    recorder.start();
    await new Promise<void>((resolve) => {
      clipTimerRef.current = window.setTimeout(resolve, spec.clipMs);
    });
    clipTimerRef.current = null;
    if (recorder.state !== "inactive") recorder.stop();
    return { blob: await finished, field: "clip" };
  }, [captureStill, spec.clipMs, spec.profile]);

  return {
    videoRef,
    devices,
    deviceId,
    previewing,
    secureContext,
    openCamera,
    capture: spec,
    recordClip,
    streamFrames,
    captureStill,
    stopStream,
  };
}
