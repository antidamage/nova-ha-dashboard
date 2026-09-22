import type { ControlFeature, ControlModule } from "./types";

/**
 * Which features a preset actually has, and what each is set to
 * (specs/control-modules.md).
 *
 * ONE gate, in one place, because a feature that the editor greys out but the
 * model still resolves to its default is a switch that lies in both directions:
 * the owner sees a control that does nothing when turned off, and the card sees
 * a feature that is "on" for a control that has no such part. `featureApplies` is
 * what the editor greys its row with and what the model drops the value with, so
 * the two cannot disagree.
 *
 * A feature that does not apply carries NOTHING, rather than a default a consumer
 * can read as "on".
 */

export type FeatureSubject = {
  driverId?: string | null;
  features?: Record<string, boolean>;
  variant?: string | null;
};

export function featureApplies(feature: ControlFeature, subject: FeatureSubject): boolean {
  if (feature.driverIds && !(subject.driverId && feature.driverIds.includes(subject.driverId))) {
    return false;
  }
  if (feature.variantIds && !(subject.variant && feature.variantIds.includes(subject.variant))) {
    return false;
  }
  return true;
}

/**
 * A preset's features resolved against its module: a missing entry means the
 * module's own default, so a preset saved before a feature existed keeps
 * behaving the way it did rather than silently gaining it.
 */
export function resolveFeatures(module: ControlModule, subject: FeatureSubject): Record<string, boolean> {
  const resolved: Record<string, boolean> = {};
  for (const feature of module.features) {
    if (!featureApplies(feature, subject)) {
      continue;
    }
    const stored = subject.features?.[feature.id];
    resolved[feature.id] = typeof stored === "boolean" ? stored : feature.default;
  }
  return resolved;
}
