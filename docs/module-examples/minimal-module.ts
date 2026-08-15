/**
 * EXAMPLE — the smallest legal dashboard module.
 *
 * Demonstrates rule 2 of SPEC.md §32.2: a module must be INERT when
 * unconfigured. No thrown error, no zone, no panel, no log spam — a home
 * without this capability should not be able to tell the module exists.
 *
 * Enforced by: lib/fresh-install.test.ts, which builds the dashboard from the
 * shipped config alone and asserts every unconfigured module reports inactive.
 *
 * The example home is invented. Nothing here refers to a real installation.
 */

import type { DashboardModule, ModuleStateContext, ModuleStatus } from "../../lib/modules/types";

export const doorbellExampleModule: DashboardModule = {
  id: "doorbell_example",
  title: "Doorbell",
  description: "Announces callers at the front door.",

  status(context: ModuleStateContext): ModuleStatus {
    // Everything installation-specific comes from config. There is no fallback
    // entity id here and there must never be one: a fallback would make this
    // module quietly bind to whatever some other house happened to call its
    // doorbell.
    const entityId = context.config.homeAssistant.classification.forceIlluminationEntityIds[0];

    const requirements = [
      {
        ok: Boolean(entityId),
        label: "Doorbell button",
        // Name the config key. This is what an operator reads when the module
        // is off and they cannot work out why.
        detail: entityId ?? "Set the doorbell entity in config to enable this.",
      },
    ];

    return {
      id: this.id,
      title: this.title,
      active: requirements.every((requirement) => requirement.ok),
      summary: entityId ? `Watching ${entityId}` : "Not configured",
      requirements,
    };
  },
};
