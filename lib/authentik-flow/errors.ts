import type { FlowChallenge } from "./types";

/** First error string authentik attached to a named field, if any. */
export function fieldError(challenge: FlowChallenge, field: string): string | null {
  const errors = challenge.response_errors?.[field];
  const first = Array.isArray(errors) ? errors[0] : undefined;
  return typeof first?.string === "string" && first.string ? first.string : null;
}

/**
 * The best single sentence to show for a challenge that came back with
 * problems. Field errors are rendered beside their fields; this is for the
 * non-field case and for stages with no fields at all.
 */
export function challengeError(challenge: FlowChallenge): string | null {
  if (typeof challenge.error_message === "string" && challenge.error_message) {
    return challenge.error_message;
  }
  const errors = challenge.response_errors;
  if (!errors) return null;
  // `non_field_errors` is DRF's own key; anything else is a field the surface
  // does not render, and showing it unlabelled beats showing nothing.
  for (const key of ["non_field_errors", ...Object.keys(errors)]) {
    const first = errors[key]?.[0];
    if (typeof first?.string === "string" && first.string) return first.string;
  }
  return null;
}
