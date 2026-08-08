/**
 * v5: the random driver split into random timing and random value.
 *
 * A `random` driver used to be two features fused together. It sampled a value
 * on its cadence and glided to it over `transitionSeconds`, ignoring the
 * binding envelope entirely — so it was at once a cadence *and* a value
 * generator, and neither could be had on its own.
 *
 * It is now just a pulse whose timing is jittered: it fires once per cadence
 * window at a random point inside it, and runs the binding envelope like every
 * other pulse. Drawing the target at random is a separate, stackable thing —
 * the binding's `randomValue`.
 *
 * So a lane authored under the old model needs both halves turned back on to
 * keep its character:
 *
 * - every binding on a random lane gets `randomValue: true`, because a random
 *   value is what that lane was *for*;
 * - the driver's old glide becomes the binding's attack, because the glide was
 *   the ramp up to the sampled value and the attack is now what draws it.
 *
 * What does not survive is the exact curve. The old glide was an exponential
 * approach that never quite arrived; the attack is linear and lands. Random
 * lanes will read as punchier, and that is the point of the change rather than
 * a regression.
 *
 * Keyed off `schemaVersion` like v4, because nothing in a stored lane
 * distinguishes "already migrated" from "authored this way on purpose": a v5
 * random lane whose bindings the user deliberately un-ticked looks exactly like
 * a v4 one that has not been converted yet.
 */
/**
 * The version THIS conversion applies below, on the same terms as
 * `PHONOSCOPE_PERCENT_GEOMETRY_VERSION` in v4 and for the reason stated there:
 * gating on "the current schema version" would re-run this over data that has
 * already had it the moment an unrelated change bumped the schema. It used to
 * be the current version as well, which was that bug waiting to happen; the
 * current version now lives in `phonoscope-migrate-v6.ts`.
 */
export const PHONOSCOPE_RANDOM_SPLIT_VERSION = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** The glide a driver carried before v5 removed the field. */
function legacyGlideSeconds(driver: Record<string, unknown>): number {
  const value = Number(driver.transitionSeconds);
  // The old default. A lane written before the field existed at all glided by
  // half a second, so that is what "absent" meant then and what it means here.
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(10, value));
}

/**
 * Turn every random lane's bindings into randomised-value bindings carrying the
 * driver's old glide as their attack.
 *
 * Runs on the RAW stored shape, before `normalizePhonoscopeSettingsGroups` —
 * which is not a stylistic choice. Normalisation drops `transitionSeconds`,
 * because v5 removed it from the driver type, so by the time the groups are
 * typed the glide this conversion exists to rescue is already gone.
 *
 * Only the lane's *primary* driver is consulted. A random modifier contributes
 * its signal to a lane the primary already shapes, and the binding has one
 * envelope and one target between them, so there is nothing separate to convert.
 *
 * Idempotent: a lane that already carries `randomValue` and an attack is
 * rewritten to the same thing, which is what makes it safe to run over
 * v3-converted output that did this conversion on the way past.
 */
export function migratePhonoscopeRandomLanes(groups: unknown): unknown {
  if (!Array.isArray(groups)) return groups;
  return groups.map((group) => {
    if (!isRecord(group) || !Array.isArray(group.lanes)) return group;
    return {
      ...group,
      lanes: group.lanes.map((lane) => {
        if (!isRecord(lane) || !Array.isArray(lane.bindings)) return lane;
        const driver = lane.driver;
        if (!isRecord(driver) || driver.type !== "random") return lane;
        const glide = legacyGlideSeconds(driver);
        return {
          ...lane,
          bindings: lane.bindings.map((binding) => {
            if (!isRecord(binding)) return binding;
            // An authored envelope wins: someone who set an attack on a random
            // lane was overriding a glide the old evaluator ignored anyway, and
            // that intent is closer to the new meaning than the glide is.
            const authored = Number.isFinite(Number(binding.attackSeconds));
            return {
              ...binding,
              randomValue: true,
              attackSeconds: authored ? binding.attackSeconds : glide,
            };
          }),
        };
      }),
    };
  });
}
