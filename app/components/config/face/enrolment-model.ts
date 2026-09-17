/**
 * Face enrolment constants and the per-clip angle prompt. Split out of
 * `FaceEnrolmentConfig.tsx` (specs/agent-token-footprint.md §4).
 */

/** `FACE_ENROL_MIN_CLIPS`. Only a starting value — the server's `needed` wins. */
export const DEFAULT_CLIPS_NEEDED = 5;

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

export const NEW_SUBJECT = "__new__";
