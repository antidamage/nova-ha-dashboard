"use client";

import { Camera, RefreshCw, ScanFace, Trash2, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfigAccordion } from "./ConfigControls";
import { ConfigSelect, type ConfigSelectOption } from "./ConfigSelect";
import { ConfirmDialog } from "./ConfirmDialog";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";

/**
 * Face enrolment — the visual twin of `SpeakerProfilesConfig`, and for the same
 * reason it sits beside it: household people and the identities recognised
 * against them.
 *
 * Consent scope, per `specs/face-auth.md`: this enrols consenting household
 * members on the household's own hardware. There is no path here to identifying
 * anyone who has not enrolled — the service answers `null` for an unknown face
 * rather than a nearest neighbour.
 *
 * Everything the browser touches is the same-origin `/api/face/*` proxy. The
 * face service's `X-Nova-Face-Key` is injected server-side in
 * `lib/face-auth-client.ts` and never reaches this file.
 */

/** `FACE_ENROL_MIN_CLIPS`. Only a starting value — the server's `needed` wins. */
const DEFAULT_CLIPS_NEEDED = 5;

/**
 * `MediaRecorder.stop()` timer.
 *
 * 4 s, not the 1 s this shipped with. `FACE_CLIP_MIN_SECONDS` is 0.8 so 1 s
 * cleared the bound, but clearing the bound was the wrong target: the liveness
 * test measures NON-RIGID motion — blink, micro-expression, out-of-plane
 * parallax — and a one-second window barely spans a single blink. It was
 * judging the clip on a signal the clip was too short to contain, which
 * pushes a genuine live face down toward the rigid end and gives the
 * anti-spoof model fewer distinct frames to work with.
 *
 * Observed on the first live enrolment: real residuals landed at 0.015-0.035
 * against a 0.012 floor — passing, but close enough to the floor that ordinary
 * stillness would fail.
 *
 * A longer clip is close to free. `core.even_frame_indices` samples a FIXED
 * `SAMPLE_FRAMES` (25) evenly across whatever length arrives, so four seconds
 * costs the same detection and embedding work as one and simply spreads those
 * 25 samples over a window wide enough to contain real movement. Only decode
 * cost grows. `FACE_CLIP_MAX_SECONDS` is raised to 6 on the service to leave
 * room for encoder overrun.
 */
const CLIP_DURATION_MS = 4000;

/**
 * One line per clip index, in order. The angles are not decoration: five frontal
 * clips enrol a subject who fails the moment they turn their head, because the
 * gallery then covers none of the poses the kiosk camera actually sees.
 */
export const ENROLMENT_ANGLE_PROMPTS = [
  "Look straight at the camera.",
  "Turn your head slightly left.",
  "Turn your head slightly right.",
  "Tilt your chin up a little.",
  "Tilt your chin down a little.",
] as const;

/**
 * `clipIndex` is zero-based: the prompt for the clip about to be recorded.
 *
 * Cycles rather than saturating. A person can hold more than one appearance —
 * Adeline wears a wig sometimes and glasses sometimes, and the embedding shifts
 * enough that each look wants its own clips — so enrolment continues past the
 * fifth. Saturating on "one more from any angle" left every clip after that
 * unguided, which is how a second set ends up five frontal clips that cover
 * none of the poses the first set covered.
 */
export function anglePrompt(clipIndex: number): string {
  return ENROLMENT_ANGLE_PROMPTS[clipIndex % ENROLMENT_ANGLE_PROMPTS.length];
}

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
 * enrolment at the street and enrol whoever walked past the front of the house.
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

function preferredClipMimeType(): string | undefined {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const supported = typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function";
  if (!supported) return undefined;
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

type FaceSubject = {
  id: string;
  name: string;
  clips: number;
  ready: boolean;
  createdAt?: string;
};

type EnrolProgress = { clipsSoFar: number; needed: number; remaining: number };

type Tone = "ok" | "error" | "info";

const NEW_SUBJECT = "__new__";

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function FaceEnrolmentConfig() {
  // `null` until mounted: `window` does not exist during the server render, and
  // guessing "secure" would flash a camera panel that cannot work.
  const [secureContext, setSecureContext] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<CameraChoice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [subjects, setSubjects] = useState<FaceSubject[]>([]);
  const [subjectId, setSubjectId] = useState<string>(NEW_SUBJECT);
  const [newName, setNewName] = useState("");
  const [progress, setProgress] = useState<EnrolProgress | null>(null);
  const [status, setStatus] = useState<{ tone: Tone; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FaceSubject | null>(null);
  const [deleting, setDeleting] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const clipTimerRef = useRef<number | null>(null);

  /**
   * Release the camera.
   *
   * Called on unmount, when the section is collapsed (`ConfigAccordion` unmounts
   * its body, so that is the same path), when the device changes, and once the
   * final clip lands. A camera light left on in someone's house is a real bug.
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

  useEffect(() => stopStream, [stopStream]);

  const loadSubjects = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/face/subjects", { cache: "no-store" });
      const payload = await readJson(response);
      if (!response.ok) {
        setStatus({
          tone: "error",
          text: response.status === 403
            ? "Face enrolment needs a signed-in session on the HTTPS address."
            : faceReasonMessage(payload?.reason, "The face service is not responding."),
        });
        return;
      }
      const list = Array.isArray(payload) ? (payload as unknown as FaceSubject[]) : [];
      setSubjects(list);
    } catch {
      setStatus({ tone: "error", text: FACE_REASON_MESSAGES.service_unavailable });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  const openCamera = useCallback(async (requestedId?: string) => {
    const media = navigator.mediaDevices;
    if (typeof media?.getUserMedia !== "function") {
      setStatus({ tone: "error", text: FACE_REASON_MESSAGES.insecure_context });
      return;
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
      setStatus(null);
    } catch (error) {
      stopStream();
      setStatus({
        tone: "error",
        text: error instanceof Error && error.name === "NotAllowedError"
          ? "Camera permission was refused for this page."
          : "The camera could not be opened.",
      });
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

  const subjectTarget = subjectId === NEW_SUBJECT ? newName.trim() : subjectId;
  const activeSubject = subjects.find((subject) => subject.id === subjectId) ?? null;
  const needed = progress?.needed ?? DEFAULT_CLIPS_NEEDED;
  const clipsSoFar = progress?.clipsSoFar ?? activeSubject?.clips ?? 0;
  const remaining = progress?.remaining ?? Math.max(0, needed - clipsSoFar);

  const captureClip = useCallback(async () => {
    if (!subjectTarget || busy) return;
    setBusy(true);
    try {
      // Nonce first: it has a 20 s TTL, so it is fetched immediately before the
      // recording rather than held across the whole session.
      const challenge = await fetch("/api/face/challenge", { method: "POST" });
      const challengePayload = await readJson(challenge);
      const nonce = typeof challengePayload?.nonce === "string" ? challengePayload.nonce : "";
      if (!challenge.ok || !nonce) {
        setStatus({
          tone: "error",
          text: faceReasonMessage(challengePayload?.reason, FACE_REASON_MESSAGES.service_unavailable),
        });
        return;
      }

      // Say what to DO, not just that it is recording. The liveness test wants
      // ordinary movement and a person told only "Recording…" holds still for
      // the camera, which is the one thing that makes a real face look rigid.
      setStatus({ tone: "info", text: "Recording — blink and move naturally…" });
      const clip = await recordClip();

      const form = new FormData();
      form.set("clip", clip, "clip.webm");
      form.set("nonce", nonce);
      const response = await fetch(`/api/face/enrol/${encodeURIComponent(subjectTarget)}`, {
        method: "POST",
        body: form,
      });
      const payload = await readJson(response);

      // Progress comes from the response, never from a client-side counter — a
      // rejected clip must not advance the count.
      if (typeof payload?.clipsSoFar === "number") {
        setProgress({
          clipsSoFar: payload.clipsSoFar,
          needed: typeof payload.needed === "number" ? payload.needed : DEFAULT_CLIPS_NEEDED,
          remaining: typeof payload.remaining === "number"
            ? payload.remaining
            : Math.max(0, (typeof payload.needed === "number" ? payload.needed : DEFAULT_CLIPS_NEEDED) - payload.clipsSoFar),
        });
      }

      if (!response.ok || payload?.accepted !== true) {
        setStatus({ tone: "error", text: faceReasonMessage(payload?.reason) });
        return;
      }

      const left = typeof payload.remaining === "number" ? payload.remaining : null;
      setStatus({
        tone: "ok",
        text: left === 0 ? "Clip accepted. Enrolment complete." : "Clip accepted.",
      });
      await loadSubjects();
      if (left === 0) {
        // Enrolment is finished; nothing further needs the camera.
        stopStream();
      }
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : FACE_REASON_MESSAGES.service_unavailable,
      });
    } finally {
      setBusy(false);
    }
  }, [busy, loadSubjects, recordClip, stopStream, subjectTarget]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/face/subjects/${encodeURIComponent(pendingDelete.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await readJson(response);
        setStatus({ tone: "error", text: faceReasonMessage(payload?.reason, "That person could not be removed.") });
        return;
      }
      setStatus({ tone: "ok", text: `${pendingDelete.name} removed.` });
      if (subjectId === pendingDelete.id) {
        setSubjectId(NEW_SUBJECT);
        setProgress(null);
      }
      await loadSubjects();
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }, [loadSubjects, pendingDelete, subjectId]);

  const subjectOptions: ConfigSelectOption<string>[] = [
    { value: NEW_SUBJECT, label: "New person…", detail: "Start a new face profile" },
    ...subjects.map((subject) => ({
      value: subject.id,
      label: subject.name,
      detail: subject.ready
        ? `${subject.clips} clips — ready`
        : `${subject.clips} of ${DEFAULT_CLIPS_NEEDED} clips`,
    })),
  ];

  const deviceOptions: ConfigSelectOption<string>[] = devices.length
    ? devices.map((device, index) => ({
        value: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
        detail: looksLikeCaptureCard(device.label ?? "")
          ? "Looks like a capture card, not a face camera"
          : undefined,
      }))
    : [{ value: "", label: "No camera selected", detail: "Start the preview to list cameras" }];

  return (
    <ConfigAccordion
      id="face-enrolment"
      title="Face Enrolment"
      icon={<ScanFace className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
    >
      <div className="grid gap-3">
        <p className="text-sm leading-relaxed text-neutral-400">
          Household faces Nova recognises, and the passkey release each one authorises. Five short
          clips at different angles. No image of anyone is kept — not the video, not a still. What
          is stored is a 512-number vector per clip, which cannot be turned back into a picture.
        </p>

        {secureContext === false ? (
          <p role="status" className="border border-amber-900/70 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
            {FACE_REASON_MESSAGES.insecure_context} Open the dashboard on its HTTPS tailnet address —
            browsers withhold the camera API entirely on an insecure origin, and enrolment also needs
            the signed-in session that only that origin can offer.
          </p>
        ) : null}

        {status ? (
          <p
            role="status"
            className={`text-sm ${status.tone === "error" ? "text-red-300" : status.tone === "ok" ? "text-emerald-300" : "text-neutral-400"}`}
          >
            {status.text}
          </p>
        ) : null}

        {secureContext !== false ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <ConfigSelect
                label="Person"
                ariaLabel="Person to enrol"
                value={subjectId}
                options={subjectOptions}
                onChange={(value) => {
                  setSubjectId(value);
                  setProgress(null);
                  setStatus(null);
                }}
              />
              <ConfigSelect
                label="Camera"
                ariaLabel="Capture camera"
                value={deviceId}
                options={deviceOptions}
                disabled={!devices.length || busy}
                onChange={(value) => {
                  setDeviceId(value);
                  void openCamera(value);
                }}
              />
            </div>

            {subjectId === NEW_SUBJECT ? (
              <label className="grid gap-1 text-xs text-neutral-400">
                Name
                <input
                  className="border border-neutral-700 bg-black/40 px-2 py-1.5 text-sm text-neutral-100"
                  value={newName}
                  maxLength={80}
                  placeholder="Who is being enrolled"
                  onChange={(event) => setNewName(event.target.value)}
                />
              </label>
            ) : null}

            <div className="relative border border-neutral-800 bg-black/40">
              <video
                ref={videoRef}
                className="aspect-video w-full bg-black object-cover"
                muted
                playsInline
                aria-label="Enrolment camera preview"
              />
              {!previewing ? (
                <p className="absolute inset-0 flex items-center justify-center text-xs uppercase tracking-widest text-neutral-500">
                  Camera off
                </p>
              ) : null}
            </div>

            <p className="text-sm font-semibold text-cyan-200">{anglePrompt(clipsSoFar)}</p>
            <p className="text-xs text-neutral-500">
              {clipsSoFar} of {needed} clips accepted{remaining > 0 ? ` — ${remaining} to go` : " — complete"}
            </p>

            <div className="flex flex-wrap gap-2">
              <MomentaryFeedbackButton
                type="button"
                className="config-page-button"
                disabled={busy}
                onClick={() => (previewing ? stopStream() : void openCamera())}
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
                {previewing ? "Stop camera" : "Start camera"}
              </MomentaryFeedbackButton>
              <MomentaryFeedbackButton
                type="button"
                className="config-page-button"
                disabled={!previewing || busy || !subjectTarget}
                onClick={() => void captureClip()}
              >
                <Video className="h-4 w-4" aria-hidden="true" />
                {busy ? "Capturing…" : "Record clip"}
              </MomentaryFeedbackButton>
              <MomentaryFeedbackButton
                type="button"
                className="config-page-button"
                disabled={loading}
                aria-label="Refresh enrolled faces"
                onClick={() => void loadSubjects()}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
                Refresh
              </MomentaryFeedbackButton>
            </div>
          </>
        ) : null}

        <section className="grid gap-1.5" aria-labelledby="enrolled-faces-heading">
          <p id="enrolled-faces-heading" className="text-xs font-bold uppercase text-neutral-400">
            Enrolled faces ({subjects.length})
          </p>
          {subjects.map((subject) => (
            <div
              key={subject.id}
              className="flex items-center gap-3 border border-neutral-800 bg-black/20 px-3 py-2 text-xs"
            >
              {/* No face image is shown because none is stored. This used to be
                  an <img> of a 256px crop; the crop is gone, so the row is a
                  name and a clip count. Adeline, 2026-09-03: "I don't want to
                  store the video and thumbnail at all for a user." */}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-neutral-200">{subject.name}</p>
                <p className="text-neutral-500">
                  {subject.clips} clip{subject.clips === 1 ? "" : "s"}
                  <span className={subject.ready ? "ml-2 text-emerald-300" : "ml-2 text-amber-300"}>
                    {subject.ready ? "ready" : "not enough clips"}
                  </span>
                </p>
              </div>
              <MomentaryFeedbackButton
                type="button"
                className="config-page-button"
                aria-label={`Remove ${subject.name}`}
                onClick={() => setPendingDelete(subject)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
              </MomentaryFeedbackButton>
            </div>
          ))}
          {!subjects.length ? <p className="text-sm text-neutral-500">Nobody is enrolled yet.</p> : null}
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        busy={deleting}
        copy={pendingDelete
          ? {
              stages: [{
                title: `Remove ${pendingDelete.name}?`,
                body: "This deletes their face data and the passkey it releases. They will need to enrol again, and any face-released session already open is unaffected — revoke that separately.",
                confirmLabel: "Remove",
              }],
            }
          : null}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </ConfigAccordion>
  );
}
