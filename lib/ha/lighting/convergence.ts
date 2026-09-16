// Bounded brightness convergence: record commanded targets and re-drive any
// light that stopped short of one.
import type { DashboardEntity, DashboardState } from "../../types";
import { isPinnedLightEntity } from "../../lighting-presets";
import {
  brightnessPctFromAttribute,
  claimLightingBrightnessTargets,
  lightingBrightnessTargetEntityIds,
  lightingBrightnessTargetFor,
  needsBrightnessConvergence,
  releaseLightingBrightnessTarget,
  releaseLightingBrightnessTargets,
  LIGHTING_CONVERGENCE_RETRY_DELAYS_MS,
} from "../../lighting-convergence";
import { hasActiveHousePartySession } from "../../house-party-coordinator";
import { buildDashboardState } from "../../state";
import { callLightingService, callMany } from "./commands";
import { numericAttribute, supportsBrightness } from "./light-model";

/**
 * Record what brightness these lights were just sent to. That record does two
 * jobs: it publishes their in-flight readings as transitional (see
 * `markLightingTransitions` in lib/state) so no client mistakes a point on the
 * fade for the result, and it drives the bounded follow-up that re-sends the
 * value to any light that stopped short.
 *
 * Pinned fixtures are excluded — their own scheduled pass owns their look.
 */
export function trackLightingBrightnessTargets(
  targets: Array<{ entity: DashboardEntity; brightnessPct: number }>,
  lighting: DashboardState["lighting"],
) {
  scheduleLightingBrightnessConvergence(
    claimLightingBrightnessTargets(
      targets
        .filter(({ entity }) => supportsBrightness(entity) && !isPinnedLightEntity(entity, lighting))
        .map(({ entity, brightnessPct }) => ({ entityId: entity.entity_id, brightnessPct })),
    ),
  );
}

/**
 * Check back on a commanded brightness and re-drive anything that did not get
 * there. Bulbs ease toward a target and occasionally stop short; without this
 * the dashboard shows what was asked for while the room sits at something else.
 *
 * Bounded on purpose — a fixed, short retry schedule that then forgets the
 * target — so it corrects a fade that missed without ever becoming a standing
 * override of a change made from Home Assistant, a wall switch, or voice.
 */
function scheduleLightingBrightnessConvergence(token: number, attempt = 0) {
  const delayMs = LIGHTING_CONVERGENCE_RETRY_DELAYS_MS[attempt];
  if (delayMs === undefined) {
    releaseLightingBrightnessTargets(token);
    return;
  }
  if (!lightingBrightnessTargetEntityIds(token).length) {
    return;
  }

  const timer = setTimeout(() => {
    void runLightingBrightnessConvergence(token, attempt);
  }, delayMs);
  timer.unref?.();
}

async function runLightingBrightnessConvergence(token: number, attempt: number) {
  const entityIds = lightingBrightnessTargetEntityIds(token);
  if (!entityIds.length) {
    return;
  }

  // A house party drives the lights on its own cadence; correcting toward an
  // older manual brightness mid-party would fight it.
  if (hasActiveHousePartySession()) {
    releaseLightingBrightnessTargets(token);
    return;
  }

  try {
    const dashboard = await buildDashboardState();
    const tasks: Promise<unknown>[] = [];

    for (const entityId of entityIds) {
      const targetPct = lightingBrightnessTargetFor(entityId, token);
      if (targetPct === null) {
        // A newer command owns this light now; its own follow-up applies.
        continue;
      }

      const entity = dashboard.entities.find((candidate) => candidate.entity_id === entityId);
      // Turned off, gone, or unavailable since the command: the target is void.
      if (!entity || entity.domain !== "light" || entity.state !== "on") {
        releaseLightingBrightnessTarget(entityId, token);
        continue;
      }

      const currentPct = brightnessPctFromAttribute(numericAttribute(entity, "brightness"));
      if (!needsBrightnessConvergence(currentPct, targetPct)) {
        releaseLightingBrightnessTarget(entityId, token);
        continue;
      }

      tasks.push(
        callLightingService("light", "turn_on", { entity_id: entityId, brightness_pct: targetPct }),
      );
    }

    if (tasks.length) {
      await callMany(tasks);
    }
  } catch (error) {
    console.error("[nova-dashboard] brightness convergence check failed", { error });
  }

  scheduleLightingBrightnessConvergence(token, attempt + 1);
}
