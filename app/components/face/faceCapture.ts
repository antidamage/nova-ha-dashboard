"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared face-capture machinery: the camera lifecycle, the clip recorder, the
 * device-preference heuristics and the refusal strings.
 *
 * Extracted from `FaceEnrolmentConfig`, which was the only caller until the
 * login surface gained a **Use Face** button (`specs/login-surface.md`). Both
 * paths POST a clip to the same service and both are judged by the same
 * liveness gate, so they must record the same way — a login that quietly used
 * different capture settings than enrolment would fail liveness for reasons no
 * error string explains.
 *
 * Everything the browser touches is the same-origin `/api/face/*` proxy. The
 * service's `X-Nova-Face-Key` is injected server-side in
 * `lib/face-auth-client.ts` and never reaches this file.
 */

/**
 * `MediaRecorder.stop()` timer.
 *
 * 4 s, not 1 s. `FACE_CLIP_MIN_SECONDS` is 0.8 so a second clears the bound,
 * but clearing the bound was the wrong target: the liveness test measures
 * NON-RIGID motion — blink, micro-expression, out-of-plane parallax — and a
 * one-second window barely spans a single blink. It judged the clip on a signal
 * the clip was too short to contain, which pushes a genuine live face toward
 * the rigid end and gives the anti-spoof model fewer distinct frames.
 *
 * Observed on the first live enrolment: real residuals landed at 0.015-0.035
 * against a 0.012 floor on one-second clips — passing, but close enough that
 * ordinary stillness would fail.
 *
 * A longer clip is close to free. `core.even_frame_indices` samples a FIXED
 * `SAMPLE_FRAMES` (25) evenly across whatever length arrives, so four seconds
 * costs the same detection and embedding work as one and simply spreads those
 * 25 samples over a window wide enough to contain real movement. Only decode
 * cost grows.
 *
 * This lives here rather than at each call site precisely so login and
 * enrolment cannot drift apart. The kiosk witness is the one caller that
 * legitimately uses a shorter clip, and it is a Python daemon calling
 * `/identify`, which is liveness-free by design — see `specs/kiosk-attribution.md`.
 */
export const CLIP_DURATION_MS = 4000;

/**
 * The refusal strings, verbatim from `specs/face-auth.md` § Enrolment UI contract.
 *
 * `liveness_rigid` and `antispoof` deliberately show the same text, and the
 * three lockout reasons collapse to one. The user gets no feedback about which
 * signal caught them — that distinction lives in the `attempts` table, where it
 * is calibration data, rather than in the UI, where it is a tuning aid for an
 * attacker.
 */
export const FACE_REASON_MESSAGES: Record<string, string> = {
  no_face: "No face found in that clip.",
  multiple_faces: "More than one face in frame.",
  face_too_small: "Move closer to the camera.",
  clip_too_short: "The clip was too short or too choppy. Try again.",
  clip_low_fps: "The clip was too short or too choppy. Try again.",
  liveness_rigid: "That did not look like a live face.",
  liveness_unstable: "Too much movement. Hold steadier.",
  antispoof: "That did not look like a live face.",
  inconsistent: "That clip does not match the others. Not counted.",
  conflicts_with_subject: "That face is already enrolled as someone else.",
  nonce_invalid: "The capture expired. Try again.",
  network_denied: "Face login is not available from this network.",
  disarmed: "Face login is switched off. Sign in with your password to turn it back on.",
  locked_out: "Face login is switched off. Sign in with your password to turn it back on.",
  rate_limited: "Face login is switched off. Sign in with your password to turn it back on.",
  no_veto_channel: "This person has no Discord account mapped. Face login is unavailable for them.",
  insecure_context: "Camera access needs the HTTPS address.",
  service_unavailable: "The face service is not responding.",
  // Reasons the service can return that the spec's UI table does not name a
  // string for. Written in the same register; not verbatim from the spec.
  clip_too_long: "The clip was too short or too choppy. Try again.",
  low_detection: "The camera could not see that face clearly enough.",
  too_few_frames: "Too few usable frames in that clip. Try again.",
  too_few_agreeing: "Not enough of the clip agreed. Try again.",
  ambiguous: "That clip was ambiguous. Not counted.",
  // Login-only: the assertion was signed but authentik would not take it.
  assertion_rejected: "The sign-in was refused. Try again, or use your password.",
};

export function faceReasonMessage(reason: unknown, fallback = "That clip was refused."): string {
  if (typeof reason !== "string" || !reason) return fallback;
  return FACE_REASON_MESSAGES[reason] ?? fallback;
}

/**
 * A capture card is not a face camera.
 *
 * The kiosk host carries two video devices: a built-in UVC webcam and an MS2109
 * grabber wired to an outdoor security camera. Binding the grabber would point
 * capture at the street and record whoever walked past the front of the house.
 * This is a *preference*, not a lock — the picker still lists every device,
 * because the labels are vendor strings and no heuristic over them is reliable
 * enough to hide a device the user might actually need.
 *
 * Deliberately not host-specific: no device path, no host name, no fixed index.
 * It reads labels, so it works on any machine with the same problem.
 */
const CAPTURE_CARD_HINTS = /(ms\d{4}|macrosilicon|capture|grabber|hdmi|usb ?video|cam ?link|av ?to ?usb|screen|virtual)/i;
const FACE_CAMERA_HINTS = /(webcam|web cam|uvc|integrated|built[- ]?in|facetime|front|user|hd cam)/i;

export function looksLikeCaptureCard(label: string): boolean {
  return CAPTURE_CARD_HINTS.test(label) && !FACE_CAMERA_HINTS.test(label);
}

export type CameraChoice = { deviceId: string; label: string };

/**
 * Highest-scoring video input, ties broken by enumeration order — which is the
 * browser's own default, so an unlabelled list behaves exactly as it would
 * without this function.
 */
export function pickPreferredCamera<T extends CameraChoice>(devices: T[]): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const device of devices) {
    const label = device.label ?? "";
    let score = 0;
    if (looksLikeCaptureCard(label)) score -= 2;
    if (FACE_CAMERA_HINTS.test(label)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = device;
    }
  }
  return best;
}

export function preferredClipMimeType(): string | undefined {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const supported = typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function";
  if (!supported) return undefined;
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

export async function readJsonBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type FaceCapture = {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  devices: CameraChoice[];
  deviceId: string;
  previewing: boolean;
  /**
   * `null` until mounted: `window` does not exist during the server render, and
   * guessing "secure" would flash a camera panel that cannot work.
   */
  secureContext: boolean | null;
  /** Resolves to an error message, or `null` on success. */
  openCamera: (requestedId?: string) => Promise<string | null>;
  recordClip: () => Promise<Blob>;
  stopStream: () => void;
};

/**
 * The camera lifecycle, shared by enrolment and by face login.
 *
 * Returns error *messages* rather than setting status itself, because the two
 * consumers present failures differently — enrolment has a toned status line,
 * the login modal has its own error slot — and a hook that owned the
 * presentation would force one of them into the other's shape.
 */
export function useFaceCapture(): FaceCapture {
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

  const openCamera = useCallback(async (requestedId?: string): Promise<string | null> => {
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
        target = pickPreferredCamera(listed)?.deviceId ?? "";
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
      return error instanceof Error && error.name === "NotAllowedError"
        ? "Camera permission was refused for this page."
        : "The camera could not be opened.";
    }
  }, [deviceId, stopStream]);

  const recordClip = useCallback(async (): Promise<Blob> => {
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
      clipTimerRef.current = window.setTimeout(resolve, CLIP_DURATION_MS);
    });
    clipTimerRef.current = null;
    if (recorder.state !== "inactive") recorder.stop();
    return finished;
  }, []);

  return {
    videoRef,
    devices,
    deviceId,
    previewing,
    secureContext,
    openCamera,
    recordClip,
    stopStream,
  };
}
