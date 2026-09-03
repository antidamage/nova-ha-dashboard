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
 * The refusal strings.
 *
 * Two rules shape these, and they pull in opposite directions.
 *
 * **Say what actually failed, and what to do about it.** A message that does
 * not distinguish "the camera could not see you", "you were not recognised" and
 * "you were recognised but sign-in could not be released" leaves the only
 * available action as "try again", which is wrong for two of the three.
 *
 * **Leak no topology.** The login screen is reachable by anyone who can load
 * the page, so nothing here names a host, a port, a service, a key, or which
 * third party a step depends on. "Recognised but not released" is the honest
 * shape of that class of failure and says nothing about the machinery.
 * `specs/login-surface.md` owns this rule.
 */
export const FACE_REASON_MESSAGES: Record<string, string> = {
  // --- the camera could not get a usable clip: retrying can work ---
  no_face: "No face found in that clip.",
  multiple_faces: "More than one face in frame.",
  face_too_small: "Move closer to the camera.",
  clip_too_short: "The clip was too short or too choppy. Try again.",
  clip_too_long: "The clip was too short or too choppy. Try again.",
  clip_low_fps: "The clip was too short or too choppy. Try again.",
  low_detection: "The camera could not see your face clearly enough.",
  too_few_frames: "Too few usable frames in that clip. Try again.",
  liveness_unstable: "Too much movement. Hold steadier.",

  // --- seen, but not matched to an enrolled person ---
  // `liveness_rigid` and `antispoof` deliberately share this text, and neither
  // says which signal caught them: that distinction lives in `attempts`, where
  // it is calibration data.
  liveness_rigid: "That did not look like a live face.",
  antispoof: "That did not look like a live face.",
  ambiguous: "Your face was not recognised clearly enough.",
  too_few_agreeing: "Your face was not recognised clearly enough.",

  // --- recognised, but the sign-in was not released ---
  // The honest shape without the machinery. Retrying will not help, and the
  // password will, so the message says so.
  no_veto_channel:
    "Your face was recognised, but sign-in could not be released. Use your password instead.",
  assertion_rejected:
    "Your face was recognised, but the sign-in was refused. Use your password instead.",
  // Recognised, but there is nothing to sign with: the sign-in credential for
  // this person has not been registered, or has been removed. Distinct from
  // every other failure because the fix is a one-off setup step, not a retry.
  no_credential:
    "Your face was recognised, but no sign-in credential is registered for you. Use your password, then set face sign-in up again.",
  face_session_invalid: "That capture expired before it could be used. Try again.",
  authentik_session_required: "That action needs a signed-in session. Use your password first.",

  // --- switched off ---
  // All three collapse to one string on purpose: which one it is tells anyone
  // probing whether their attempts have tripped a counter.
  disarmed: "Face sign-in is switched off. Sign in with your password to turn it back on.",
  locked_out: "Face sign-in is switched off. Sign in with your password to turn it back on.",
  rate_limited: "Face sign-in is switched off. Sign in with your password to turn it back on.",

  // --- the request could not be made at all ---
  nonce_invalid: "The capture expired. Try again.",
  network_denied: "Face sign-in is not available from this network.",
  insecure_context: "Camera access needs the HTTPS address.",
  service_unavailable: "Face sign-in is not responding.",

  // --- enrolment only ---
  inconsistent: "That clip does not match the others. Not counted.",
  conflicts_with_subject: "That face is already enrolled as someone else.",
};

/**
 * Reasons whose exact name is NOT shown to the user.
 *
 * Everything else gets its stable reason string rendered alongside the message,
 * because a name that can be searched for is the difference between "it didn't
 * work" and a fixable report. These are the exceptions:
 *
 * - the liveness and match signals, because naming which one caught you is a
 *   tuning aid for somebody iterating against the thresholds; and
 * - the three switched-off reasons, because telling them apart says whether a
 *   probing campaign has tripped the lockout counter.
 *
 * Both exclusions are `specs/face-auth.md`'s existing decisions, kept rather
 * than quietly reversed.
 */
const UNNAMED_REASONS = new Set([
  "liveness_rigid",
  "antispoof",
  "ambiguous",
  "too_few_agreeing",
  "disarmed",
  "locked_out",
  "rate_limited",
]);

export type FaceReasonDetail = {
  message: string;
  /** Stable reason string to show beside the message, or null to withhold it. */
  code: string | null;
};

export function faceReasonDetail(reason: unknown, fallback: string): FaceReasonDetail {
  if (typeof reason !== "string" || !reason) {
    return { message: fallback, code: null };
  }
  const known = FACE_REASON_MESSAGES[reason];
  return {
    // An unrecognised reason still gets named. A refusal the UI has no wording
    // for is exactly the case where the raw string is worth the most.
    message: known ?? fallback,
    code: UNNAMED_REASONS.has(reason) ? null : reason,
  };
}

export function faceReasonMessage(reason: unknown, fallback = "That clip was refused."): string {
  return faceReasonDetail(reason, fallback).message;
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
