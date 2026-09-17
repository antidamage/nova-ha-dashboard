import type { DoorbellKnock, DoorbellSecretTemplate, DoorbellSequence, SecretMatch } from "./types";

export const DOORBELL_SEQUENCE_SCHEMA_VERSION = 1;

export function isDoorbellSequence(value: unknown): value is DoorbellSequence {
  if (!value || typeof value !== "object") {
    return false;
  }
  const seq = value as Partial<DoorbellSequence>;
  return (
    seq.schema === DOORBELL_SEQUENCE_SCHEMA_VERSION
    && typeof seq.eventId === "string"
    && seq.eventId.length > 0
    && seq.eventId.length <= 128
    && typeof seq.deviceId === "string"
    && seq.deviceId.length > 0
    && typeof seq.presence === "boolean"
    && Number.isFinite(seq.presenceAgeMs)
    && Number.isFinite(seq.noiseFloor)
    && Number.isFinite(seq.configVersion)
    && Array.isArray(seq.knocks)
    // A device that reports hundreds of knocks is faulty or hostile; either
    // way the payload is bounded before any of it is trusted.
    && seq.knocks.length > 0
    && seq.knocks.length <= 32
    && seq.knocks.every(
      (k) => k && Number.isFinite(k.atMs) && Number.isFinite(k.peak) && k.atMs >= 0,
    )
  );
}

/** Gaps between consecutive knocks. A sequence of n knocks has n-1 intervals. */
export function intervalsOf(knocks: DoorbellKnock[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < knocks.length; i += 1) {
    out.push(knocks[i].atMs - knocks[i - 1].atMs);
  }
  return out;
}

/**
 * Score a sequence against a stored template.
 *
 * Matching is on interval *ratios* plus an overall pace check, not absolute
 * timestamps: the same rhythm knocked a little faster or slower is still the
 * same rhythm, but a different rhythm at any speed is not. A mismatched knock
 * count is rejected outright rather than penalised, because a template with
 * one extra tap is a different credential.
 */
export function scoreSecret(
  knocks: DoorbellKnock[],
  template: DoorbellSecretTemplate,
): SecretMatch {
  const observed = intervalsOf(knocks);
  if (observed.length === 0 || observed.length !== template.intervals.length) {
    return { id: template.id, score: 0 };
  }

  const templateTotal = template.intervals.reduce((a, b) => a + b, 0);
  const observedTotal = observed.reduce((a, b) => a + b, 0);
  if (templateTotal <= 0 || observedTotal <= 0) {
    return { id: template.id, score: 0 };
  }

  const pace = observedTotal / templateTotal;
  const [paceMin, paceMax] = template.paceRange;
  if (pace < paceMin || pace > paceMax) {
    return { id: template.id, score: 0 };
  }

  // Compare each interval after normalising out the overall pace, so a
  // uniformly faster performance is not penalised twice.
  let worst = 1;
  for (let i = 0; i < observed.length; i += 1) {
    const expected = template.intervals[i] * pace;
    if (expected <= 0) {
      return { id: template.id, score: 0 };
    }
    const error = Math.abs(observed[i] - expected) / expected;
    if (error > template.tolerance) {
      return { id: template.id, score: 0 };
    }
    worst = Math.min(worst, 1 - error / template.tolerance);
  }

  return { id: template.id, score: worst };
}

/**
 * Pick the best match, but only if it is clearly better than the runner-up.
 *
 * Two similar rhythms that both fit means the household cannot know which
 * credential was used, so the safe answer is "no match at all".
 */
export function bestSecretMatch(
  knocks: DoorbellKnock[],
  templates: DoorbellSecretTemplate[],
  ambiguityMargin: number,
): { match: SecretMatch | null; ambiguous: boolean } {
  const scored = templates
    .map((t) => scoreSecret(knocks, t))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { match: null, ambiguous: false };
  }
  if (scored.length === 1) {
    return { match: scored[0], ambiguous: false };
  }
  if (scored[0].score - scored[1].score < ambiguityMargin) {
    return { match: null, ambiguous: true };
  }
  return { match: scored[0], ambiguous: false };
}
