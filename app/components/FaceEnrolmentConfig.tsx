"use client";

// Facade: the face enrolment section lives in app/components/config/face/.
// Reached through UserDataConfig; it keeps the published helpers its tests
// import (specs/agent-token-footprint.md §3.3).
export { FaceEnrolmentConfig } from "./config/face/FaceEnrolmentConfig";
export { ENROLMENT_ANGLE_PROMPTS, anglePrompt } from "./config/face/enrolment-model";

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
