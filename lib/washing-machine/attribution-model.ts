import type { AutoAttributionConfig, WashingMachineCycle, WashRule } from "./types";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Which pattern rule, if any, makes this wash the configured person's
 * (specs/power-meters.md §4.5). `stored` is the cycle store; only cycles that
 * ended at or before this one started are considered. Null means unsure.
 */
export function autoAttributeCycle(
  cycle: { endedAt: string; startedAt: string },
  stored: WashingMachineCycle[],
  rules: AutoAttributionConfig,
): WashRule | null {
  const start = Date.parse(cycle.startedAt);
  const minutes = (Date.parse(cycle.endedAt) - start) / MINUTE_MS;
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  const prior = stored.filter((candidate) => Date.parse(candidate.endedAt) <= start);
  const standard = minutes >= rules.standardMinMinutes && minutes <= rules.standardMaxMinutes;
  const theirs = prior.filter((candidate) => candidate.person === rules.personId);

  if (standard) {
    const lastEnd = Math.max(-Infinity, ...theirs.map((candidate) => Date.parse(candidate.endedAt)));
    // With none of their washes on record, only a long enough history counts:
    // missing data is not evidence they have not washed.
    const since = Number.isFinite(lastEnd)
      ? start - lastEnd
      : start - Math.min(Infinity, ...stored.map((candidate) => Date.parse(candidate.startedAt)));
    if (since >= rules.minDaysSinceLast * DAY_MS) return "day-gap";
  }

  const preceding = prior.reduce<WashingMachineCycle | null>(
    (latest, candidate) => (!latest || candidate.endedAt > latest.endedAt ? candidate : latest),
    null,
  );
  if (preceding?.person !== rules.personId) return null;
  const gapMinutes = (start - Date.parse(preceding.endedAt)) / MINUTE_MS;
  if (standard && gapMinutes <= rules.consecutiveMaxGapMinutes) return "consecutive";
  if (minutes <= rules.spinMaxMinutes && gapMinutes <= rules.spinMaxGapMinutes) return "spin";
  return null;
}

/**
 * Apply the rules to a cycle at close. A manual claim — or a person set before
 * attribution was recorded — is left alone; an auto guess that no longer holds
 * reverts to unassigned.
 */
export function settleAutoAttribution(
  cycle: WashingMachineCycle,
  stored: WashingMachineCycle[],
  rules: AutoAttributionConfig | undefined,
  at: string,
): WashingMachineCycle {
  if (!rules?.enabled || cycle.attribution?.source === "manual") return cycle;
  if (cycle.person && cycle.attribution?.source !== "auto") return cycle;
  const rule = autoAttributeCycle(cycle, stored, rules);
  if (rule) {
    const attribution = cycle.attribution?.rule === rule ? cycle.attribution : { at, rule, source: "auto" as const };
    return { ...cycle, attribution, person: rules.personId };
  }
  if (cycle.attribution?.source !== "auto") return cycle;
  const { attribution: _dropped, ...rest } = cycle;
  return { ...rest, person: null };
}
