/**
 * EXAMPLE — enriching entity data before zones are assembled.
 *
 * Demonstrates `transformEntities` plus rule 3 of SPEC.md §32.2: absence must
 * not degrade anything else. This module mutates entities in place and must
 * behave correctly whether it runs first, last, or not at all.
 *
 * It also shows the sanctioned way to report a problem: push onto
 * `context.warnings`. Do not console.warn in its place, and do not throw — a
 * stale sensor is a condition to report, not a crash.
 *
 * Enforced by: lib/no-household-data.test.ts (the trusted sensor is configured,
 * never a constant) and lib/fresh-install.test.ts (absent config is inert).
 *
 * The example home is invented — a Study.
 */

import type { DashboardModule, ModuleStateContext, ModuleStatus } from "../../lib/modules/types";

const STALE_AFTER_MS = 30 * 60_000;

type TrustedSensor = { areaId: string; temperatureEntityId: string };

function trustedSensors(context: ModuleStateContext): TrustedSensor[] {
  const ha = context.config.homeAssistant as unknown as { trustedRoomSensors?: TrustedSensor[] };
  return ha.trustedRoomSensors ?? [];
}

export const trustedRoomSensorExampleModule: DashboardModule = {
  id: "trusted_room_sensor_example",
  title: "Trusted room sensors",
  description: "Prefers a standalone room sensor over a device's own internal reading.",

  transformEntities(context: ModuleStateContext): void {
    for (const trusted of trustedSensors(context)) {
      const sensor = context.entities.find((entity) => entity.entity_id === trusted.temperatureEntityId);
      if (!sensor) {
        // Configured but not present in Home Assistant. Say so once, in the
        // place the user will actually see it, and carry on.
        context.warnings.push(
          `Trusted room sensor ${trusted.temperatureEntityId} is configured but not in Home Assistant.`,
        );
        continue;
      }

      const reportedAt = Date.parse(String(sensor.last_updated ?? ""));
      const stale = !Number.isFinite(reportedAt) || Date.now() - reportedAt > STALE_AFTER_MS;
      if (stale) {
        // Deliberately does NOT substitute a nearby sensor. A wrong reading
        // presented confidently is worse than a missing one, and anything
        // driving heating or cooling must fail toward "no reading" rather than
        // toward a plausible guess.
        context.warnings.push(`Trusted room sensor ${trusted.temperatureEntityId} is stale; ignoring it.`);
        continue;
      }

      for (const entity of context.entities) {
        if (entity.area_id !== trusted.areaId || entity.domain !== "climate") continue;
        entity.attributes = { ...entity.attributes, current_temperature: Number(sensor.state) };
      }
    }
  },

  status(context: ModuleStateContext): ModuleStatus {
    const sensors = trustedSensors(context);
    const requirements = sensors.map((trusted) => ({
      ok: context.entities.some((entity) => entity.entity_id === trusted.temperatureEntityId),
      label: `Room sensor for ${trusted.areaId}`,
      detail: trusted.temperatureEntityId,
    }));

    return {
      id: this.id,
      title: this.title,
      active: requirements.length > 0 && requirements.some((requirement) => requirement.ok),
      summary: sensors.length ? `${sensors.length} trusted sensor(s)` : "None configured",
      requirements: requirements.length
        ? requirements
        : [{ ok: false, label: "Trusted sensors", detail: "Set homeAssistant.trustedRoomSensors to enable." }],
    };
  },
};
