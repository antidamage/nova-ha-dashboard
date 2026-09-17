"use client";

import type { CaptureProfileName, CaptureSpec } from "./types";

/**
 * The `standard` clip length, and the default for any surface that does not ask
 * for something else.
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
 * **A surface may choose a shorter capture, and the service then runs a
 * different gate rather than the same gate on worse evidence.** That is the
 * `CAPTURE_PROFILES` table below: `quick` and `image` switch the liveness and
 * anti-spoof gates off outright, because a residual floor low enough to pass a
 * genuine one-second capture is low enough to pass a photograph, and a gate
 * tuned to that number is not a gate. What replaces it is a session that
 * expires after 15 minutes of inactivity — see `specs/login-surface.md`.
 *
 * `quick` records no clip at all any more (2026-09-11). It posts single stills
 * until the service holds two it can use, then stops — so clip length and frame
 * rate, which refused a modest webcam outright before a face was ever looked
 * at, are not judged on that path at all.
 *
 * Enrolment is not one of those surfaces and never becomes one. A photograph
 * enrolled into the gallery authenticates every later sign-in, including the
 * `standard` ones, so it keeps the full 4 s gate.
 */
export const CLIP_DURATION_MS = 4000;

export const CAPTURE_PROFILES: Record<CaptureProfileName, CaptureSpec> = {
  standard: { profile: "standard", clipMs: CLIP_DURATION_MS },
  quick: { profile: "quick", clipMs: 0, streamGiveUpMs: 5000 },
  image: { profile: "image", clipMs: 0 },
};

/**
 * Refusals from `/frame` that end the attempt without an `/assert`. Anything
 * else — a skipped still, `frame_limit` — just means "keep going" or "go and
 * let `/assert` decide".
 */
export const STREAM_FATAL_REASONS = new Set([
  "nonce_invalid",
  "network_denied",
  "disarmed",
  "locked_out",
  "rate_limited",
  "service_unavailable",
  "forbidden",
]);

export const DEFAULT_CAPTURE = CAPTURE_PROFILES.standard;

/**
 * How hard to try when the camera is busy rather than absent.
 *
 * Two retries a second apart comfortably outlasts the witness daemon's ~1.2 s
 * capture, which is the contender that actually causes this, without leaving
 * somebody staring at a dead button if the camera is genuinely gone.
 */
export const CAMERA_BUSY_RETRIES = 2;
export const CAMERA_BUSY_RETRY_MS = 1000;

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
  too_few_frames: "The camera did not get a clear enough look at you. Try again.",
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
