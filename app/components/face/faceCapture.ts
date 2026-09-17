"use client";

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
 *
 * Face capture — facade. The body lives in face/capture/
 * (specs/agent-token-footprint.md §3.3).
 *
 *   capture/types.ts            CaptureSpec, FaceCapture, camera and refusal shapes
 *   capture/constants.ts        clip length, capture profiles, refusal strings
 *   capture/capture-model.ts    refusal detail, camera preference, clip MIME type
 *   capture/store.ts            SOLE state owner: cached camera preferences
 *   capture/useFaceCapture.ts   the camera lifecycle hook: stream, still, clip
 */

export type {
  CameraChoice,
  CameraPreference,
  CaptureProfileName,
  CaptureSpec,
  FaceCapture,
  FaceReasonDetail,
  StreamResult,
} from "./capture/types";
export { CAPTURE_PROFILES, CLIP_DURATION_MS, DEFAULT_CAPTURE, FACE_REASON_MESSAGES } from "./capture/constants";
export {
  faceReasonDetail,
  faceReasonMessage,
  looksLikeCaptureCard,
  pickPreferredCamera,
  preferredClipMimeType,
  readJsonBody,
} from "./capture/capture-model";
export { useFaceCapture } from "./capture/useFaceCapture";
