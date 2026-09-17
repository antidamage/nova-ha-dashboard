"use client";

import { Camera, RefreshCw, ScanFace, Video } from "lucide-react";
import { ConfigAccordion } from "../../ConfigControls";
import { ConfigSelect, type ConfigSelectOption } from "../../ConfigSelect";
import { ConfirmDialog } from "../../ConfirmDialog";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { FACE_REASON_MESSAGES, looksLikeCaptureCard } from "../../face/faceCapture";
import { FacePreview } from "../../face/FacePreview";
import { EnrolledFacesList } from "./EnrolledFacesList";
import { DEFAULT_CLIPS_NEEDED, NEW_SUBJECT, anglePrompt } from "./enrolment-model";
import { useFaceEnrolment } from "./useFaceEnrolment";

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

// State and the /api/face/* calls are in useFaceEnrolment; the enrolled list is
// EnrolledFacesList (specs/agent-token-footprint.md §4).
export function FaceEnrolmentConfig() {
  const {
    videoRef, devices, deviceId, previewing, secureContext, stopStream,
    subjects, subjectId, setSubjectId, newName, setNewName, setProgress,
    status, setStatus, busy, loading, pendingDelete, setPendingDelete, deleting,
    loadSubjects, startCamera, subjectTarget, needed, clipsSoFar, remaining,
    captureClip, confirmDelete,
  } = useFaceEnrolment();

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

        <EnrolledFacesList setPendingDelete={setPendingDelete} subjects={subjects} />
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
