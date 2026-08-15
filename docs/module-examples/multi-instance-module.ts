/**
 * EXAMPLE — zero to N instances from a config array.
 *
 * Demonstrates rule 4 of SPEC.md §32.2: multi-instance by default. One-of-a-kind
 * is a special case of N, not the shape to design for.
 *
 * This rule was learned the hard way. A heater and an air conditioner were each
 * modelled as the only one that could exist, with the room they happened to be
 * in written into the component ("Bedroom", "Lounge") and their sensors written
 * into source. A second heater was unrepresentable, and a household with none
 * still carried both cards.
 *
 * Enforced by: lib/no-household-data.test.ts (no room names or entity ids in
 * source) and lib/fresh-install.test.ts (an empty array renders nothing).
 *
 * The example homes are invented — a Study and a Garage.
 */

import type { DashboardModule, ModuleStateContext, ModuleStatus } from "../../lib/modules/types";

/**
 * Shape of one configured instance. Note there is no `theOnlyOne` anywhere: the
 * config is an array from the start, so a home with three of these needs no
 * code change, and a home with none needs no special case.
 *
 * In config this would be, for example:
 *
 *   "dashboard": {
 *     "extractorFans": [
 *       { "id": "study",  "title": "Study",  "switchEntityIds": ["switch.study_fan"] },
 *       { "id": "garage", "title": "Garage", "switchEntityIds": ["switch.garage_fan"] }
 *     ]
 *   }
 */
type ExtractorFanInstance = {
  id: string;
  title: string;
  switchEntityIds: string[];
};

function configuredInstances(context: ModuleStateContext): ExtractorFanInstance[] {
  // Cast stands in for a real zod-validated config block; see
  // module-config-schema.ts for how that block is declared.
  const dashboard = context.config.dashboard as unknown as {
    extractorFans?: ExtractorFanInstance[];
  };
  return dashboard.extractorFans ?? [];
}

export const extractorFanExampleModule: DashboardModule = {
  id: "extractor_fan_example",
  title: "Extractor fans",
  description: "Humidity-driven extractor fans, one per room that has one.",

  status(context: ModuleStateContext): ModuleStatus {
    const instances = configuredInstances(context);

    // An empty array is not an error and not a warning. It is a home without
    // extractor fans, which is a perfectly ordinary home.
    if (instances.length === 0) {
      return {
        id: this.id,
        title: this.title,
        active: false,
        summary: "No extractor fans configured",
        requirements: [
          {
            ok: false,
            label: "At least one fan",
            detail: "Add entries to dashboard.extractorFans to enable this.",
          },
        ],
      };
    }

    // One requirement per instance, so a half-configured home can see exactly
    // which room is the problem rather than a single unhelpful failure.
    const requirements = instances.map((instance) => {
      const present = instance.switchEntityIds.some((entityId) =>
        context.states.some((state) => state.entity_id === entityId),
      );
      return {
        ok: present,
        label: instance.title,
        detail: present ? instance.switchEntityIds.join(", ") : `Missing: ${instance.switchEntityIds.join(", ")}`,
      };
    });

    return {
      id: this.id,
      title: this.title,
      // Active when ANY instance works: one broken fan should not hide the
      // others. Contrast with the power module, where both halves are required
      // because either alone is misleading rather than merely partial.
      active: requirements.some((requirement) => requirement.ok),
      summary: `${requirements.filter((r) => r.ok).length}/${instances.length} fans available`,
      requirements,
    };
  },
};
