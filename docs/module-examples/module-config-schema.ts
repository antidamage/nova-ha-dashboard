/**
 * EXAMPLE — the zod block that goes with a module.
 *
 * Demonstrates rule 1 of SPEC.md §32.2 and the clause that matters most in the
 * golden rule: a config read with a hard-coded fallback beside it does NOT
 * satisfy the rule.
 *
 * Enforced by: lib/no-household-data.test.ts and lib/fresh-install.test.ts,
 * which asserts the shipped config contains no entity ids.
 *
 * The example homes are invented — a Study and a Garage.
 */

import { z } from "zod";

const entityIdSchema = z.string().min(1);

/**
 * GOOD: generic defaults, no household values, and multi-instance from the
 * start. A fresh install validates with `[]` and the module reports inactive.
 */
export const ExtractorFanConfigSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      /**
       * A LIST, not a single id. During a Home Assistant rename you list both
       * the old and new id and the first one present wins, so renaming a device
       * is a config edit rather than a code change and a deploy. This is the
       * shape that would have prevented the incident this whole convention came
       * out of: renaming one light orphaned a hard-coded table in source.
       */
      switchEntityIds: z.array(entityIdSchema).min(1),
      humiditySensorEntityIds: z.array(entityIdSchema).default([]),
      runOnPercent: z.number().min(0).max(100).default(70),
    }),
  )
  .default([]);

/**
 * GOOD: a required value with no default. If a home enables this capability it
 * must say what it pays; there is no sane guess, so validation fails loudly
 * rather than inventing one.
 */
export const TariffExampleSchema = z.object({
  planName: z.string().min(1),
  unitRateCents: z.number().nonnegative(),
});

/**
 * BAD — do not copy. Every line below is a mistake this codebase has actually
 * made.
 *
 * ```ts
 * // 1. A household's entity id as a schema default. Every install inherits it.
 * roomSensorEntityId: z.string().default("sensor.study_temperature"),
 *
 * // 2. A city as a default. Every install shows that city's time.
 * timeZone: z.string().default("Pacific/Auckland"),
 *
 * // 3. One home's tariff as a default. Every install prices energy wrongly,
 * //    and confidently.
 * unitRateCents: z.number().default(28.4),
 * ```
 *
 * And in the consuming code, the subtler version of the same mistake:
 *
 * ```ts
 * // The value LOOKS configurable, but the household value is still compiled
 * // in, and still used whenever config is absent or falsy. Moving a value into
 * // config does not remove it from the bundle.
 * const endDay = config.billing.endDay || BILLING_END_DAY;
 * const temps = config.monthlyTempsC[i] ?? aucklandMonthlyTempsC[i];
 *
 * // Worse: the config value is passed in and then filtered against a constant,
 * // so setting it can never change anything at all.
 * const trusted = entityIds.filter((id) => id === HARD_CODED_SENSOR_ID);
 * ```
 *
 * If a value genuinely has no safe generic default, make it required and let
 * validation fail. A loud error at startup beats a silent wrong answer forever.
 */
export const BAD_EXAMPLES_DO_NOT_COPY = true;
