"use client";

import { FACE_REASON_MESSAGES } from "./constants";
import type { CameraChoice, CameraPreference, FaceReasonDetail } from "./types";

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

/**
 * Highest-scoring video input.
 *
 * `preferences` — `dashboard.kiosk.cameras`, most preferred first — is checked
 * BEFORE the generic heuristic below, and decisively: a named match always
 * outranks the label heuristic, in preference-list order. Without this, two
 * cameras that both look like "a webcam" score identically under
 * `FACE_CAMERA_HINTS` and the tie breaks on enumeration order, which is not a
 * choice anyone made — it is whatever the browser happened to list first. A
 * panel with a LifeCam AND a built-in webcam needs to pick the LifeCam every
 * time, not on a coin flip.
 *
 * The generic heuristic remains the fallback for a device with no explicit
 * preference: still avoid anything that looks like a capture card, still
 * prefer anything that looks like a face-facing webcam, ties broken by
 * enumeration order as before.
 */
export function pickPreferredCamera<T extends CameraChoice>(
  devices: T[],
  preferences: CameraPreference[] = [],
): T | undefined {
  for (const pref of preferences) {
    if (!pref.match) continue;
    const wanted = pref.match.toLowerCase();
    const found = devices.find((device) => (device.label ?? "").toLowerCase().includes(wanted));
    if (found) return found;
  }

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
