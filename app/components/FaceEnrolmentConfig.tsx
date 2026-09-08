"use client";

import { Camera, RefreshCw, ScanFace, Trash2, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ConfigAccordion } from "./ConfigControls";
import { ConfigSelect, type ConfigSelectOption } from "./ConfigSelect";
import { ConfirmDialog } from "./ConfirmDialog";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import {
  FACE_REASON_MESSAGES,
  faceReasonMessage,
  looksLikeCaptureCard,
  readJsonBody,
  useFaceCapture,
} from "./face/faceCapture";
import { FacePreview } from "./face/FacePreview";

// The camera lifecycle, the clip recorder, the device heuristics and the
// refusal strings moved to ./face/faceCapture when the login surface gained a
// Use Face button and became a second caller. Re-exported here because this
// module was their published home and the enrolment tests import them from it.
export {
  CLIP_DURATION_MS,
  FACE_REASON_MESSAGES,
  faceReasonMessage,
  looksLikeCaptureCard,
  pickPreferredCamera,
} from "./face/faceCapture";
export type { CameraChoice } from "./face/faceCapture";

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

export function FaceEnrolmentConfig() {
  const {
    videoRef,
    devices,
    deviceId,
    previewing,
    secureContext,
    openCamera,
    recordClip,
    stopStream,
  } = useFaceCapture();
  const [subjects, setSubjects] = useState<FaceSubject[]>([]);
  const [subjectId, setSubjectId] = useState<string>(NEW_SUBJECT);
  const [newName, setNewName] = useState("");
  const [progress, setProgress] = useState<EnrolProgress | null>(null);
  const [status, setStatus] = useState<{ tone: Tone; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FaceSubject | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadSubjects = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/face/subjects", { cache: "no-store" });
      const payload = await readJsonBody(response);
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

  // `useFaceCapture` returns the failure rather than presenting it, because the
  // login modal shows the same failures in a different place. This is where it
  // becomes a toned status line.
  const startCamera = useCallback(async (requestedId?: string) => {
    const failure = await openCamera(requestedId);
    setStatus(failure ? { tone: "error", text: failure } : null);
  }, [openCamera]);

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
      const challengePayload = await readJsonBody(challenge);
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
      // Enrolment is `standard` and stays there, so this is always a clip.
      // A photograph enrolled into the gallery authenticates every later
      // sign-in, including the ones that did keep their gates, which is why the
      // short profiles are a login-surface choice and never an enrolment one.
      const { blob } = await recordClip();

      const form = new FormData();
      form.set("clip", blob, "clip.webm");
      form.set("nonce", nonce);
      const response = await fetch(`/api/face/enrol/${encodeURIComponent(subjectTarget)}`, {
        method: "POST",
        body: form,
      });
      const payload = await readJsonBody(response);

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
        const payload = await readJsonBody(response);
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
                  // openCamera sets the device id itself once it has bound the
                  // stream, so there is nothing to set here first.
                  void startCamera(value);
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

            <FacePreview
              ariaLabel="Enrolment camera preview"
              label={devices.find((device) => device.deviceId === deviceId)?.label}
              previewing={previewing}
              videoRef={videoRef}
            />

            <p className="text-sm font-semibold text-cyan-200">{anglePrompt(clipsSoFar)}</p>
            <p className="text-xs text-neutral-500">
              {clipsSoFar} of {needed} clips accepted{remaining > 0 ? ` — ${remaining} to go` : " — complete"}
            </p>

            <div className="flex flex-wrap gap-2">
              <MomentaryFeedbackButton
                type="button"
                className="config-page-button"
                disabled={busy}
                onClick={() => (previewing ? stopStream() : void startCamera())}
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
