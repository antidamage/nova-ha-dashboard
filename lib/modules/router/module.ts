import type { DashboardConfig } from "../../config-schema";
import type { HaState, RouterMetric, RouterStatus } from "../../types";
import { haRest } from "../../ha/client";
import { readDashboardConfig } from "../../dashboard-config";
import { stateById } from "../../ha/states";
import type { DashboardModule, ModuleStateContext, ModuleStatus } from "../types";

const ROUTER_STATUS_CACHE_MS = 250;

let routerStatusCache: { at: number; value: RouterStatus } | null = null;
let routerStatusRequest: Promise<RouterStatus> | null = null;

function dataRateUnitFactorToMegabytes(unit: string) {
  const compact = unit.trim().replace(/\s+/g, "");
  if (!compact) {
    return 1;
  }

  if (/^B(?:\/s|ps)$/.test(compact)) {
    return 1 / 1_000_000;
  }
  if (/^[kK]B(?:\/s|ps)$/.test(compact)) {
    return 1 / 1_000;
  }
  if (/^[mM]B(?:\/s|ps)$/.test(compact)) {
    return 1;
  }
  if (/^[gG]B(?:\/s|ps)$/.test(compact)) {
    return 1_000;
  }
  if (/^KiB(?:\/s|ps)$/i.test(compact)) {
    return 1 / 1_024;
  }
  if (/^MiB(?:\/s|ps)$/i.test(compact)) {
    return 1;
  }
  if (/^GiB(?:\/s|ps)$/i.test(compact)) {
    return 1_024;
  }

  const lower = compact.toLowerCase();
  if (["byte/s", "bytes/s", "byteps", "bytesps"].includes(lower)) {
    return 1 / 1_000_000;
  }
  if (["kilobyte/s", "kilobytes/s", "kbps"].includes(lower) && compact.includes("B")) {
    return 1 / 1_000;
  }
  if (["megabyte/s", "megabytes/s", "mbps"].includes(lower) && compact.includes("B")) {
    return 1;
  }
  if (["gigabyte/s", "gigabytes/s", "gbps"].includes(lower) && compact.includes("B")) {
    return 1_000;
  }

  if (["bit/s", "bits/s", "bps", "b/s"].includes(lower)) {
    return 1 / 8_000_000;
  }
  if (["kbit/s", "kilobit/s", "kilobits/s", "kb/s", "kbps"].includes(lower)) {
    return 1 / 8_000;
  }
  if (["mbit/s", "megabit/s", "megabits/s", "mb/s", "mbps"].includes(lower)) {
    return 1 / 8;
  }
  if (["gbit/s", "gigabit/s", "gigabits/s", "gb/s", "gbps"].includes(lower)) {
    return 125;
  }

  return 1;
}

export function normalizeDataRateToMegabytesPerSecond(value: number, unit: string) {
  return value * dataRateUnitFactorToMegabytes(unit);
}

function formatSpeed(value: number) {
  if (value >= 10) {
    return value.toFixed(0);
  }
  if (value >= 0.1) {
    return value.toFixed(1);
  }
  if (value > 0) {
    return value.toFixed(3);
  }
  return "0.0";
}

function speedMetric(states: HaState[], entityId: string): RouterMetric {
  const state = stateById(states, entityId);
  const sourceUnit = String(state?.attributes?.unit_of_measurement ?? "MB/s");
  const value = Number(state?.state);
  const numericValue = Number.isFinite(value) ? normalizeDataRateToMegabytesPerSecond(value, sourceUnit) : null;
  const unit = "MB/s";

  return {
    entity_id: entityId,
    value: numericValue,
    unit,
    display: numericValue === null ? "--" : `${formatSpeed(numericValue)} ${unit}`,
  };
}

function usableRouterRateState(state: HaState | undefined) {
  if (!state || ["unknown", "unavailable"].includes(state.state)) {
    return false;
  }

  const value = Number(state.state);
  return Number.isFinite(value);
}

/**
 * Pick the entity actually reporting a rate, tolerating a router firmware
 * update that renames its sensors.
 *
 * `alternates` are other ids the same router has been known to publish, most
 * preferred first, from `homeAssistant.router.fallbackEntityIds`. They used to
 * be four constants naming one household's router model, which meant nobody
 * else's rename could ever be absorbed.
 */
export function selectRouterRateEntityId(
  states: HaState[],
  configuredEntityId: string,
  alternates: readonly string[] = [],
) {
  if (usableRouterRateState(stateById(states, configuredEntityId))) {
    return configuredEntityId;
  }

  const live = alternates.find((entityId) => usableRouterRateState(stateById(states, entityId)));
  return live ?? configuredEntityId;
}

export function buildRouterStatus(states: HaState[], config: DashboardConfig): RouterStatus {
  const router = config.homeAssistant.router;
  const wan = stateById(states, router.wanStatusEntityId);
  const externalIp = stateById(states, router.externalIpEntityId)?.state;

  return {
    name: router.name,
    download: speedMetric(
      states,
      selectRouterRateEntityId(states, router.downloadSpeedEntityId, router.fallbackDownloadSpeedEntityIds),
    ),
    upload: speedMetric(
      states,
      selectRouterRateEntityId(states, router.uploadSpeedEntityId, router.fallbackUploadSpeedEntityIds),
    ),
    externalIp: externalIp && !["unknown", "unavailable"].includes(externalIp) ? externalIp : "--",
    wanConnected: wan ? wan.state === "on" : null,
    wanState: wan ? (wan.state === "on" ? "Connected" : "Disconnected") : "Unknown",
  };
}

export async function buildRouterStatusOnly(): Promise<RouterStatus> {
  const now = Date.now();
  if (routerStatusCache && now - routerStatusCache.at < ROUTER_STATUS_CACHE_MS) {
    return routerStatusCache.value;
  }

  if (!routerStatusRequest) {
    const config = await readDashboardConfig();
    routerStatusRequest = haRest<HaState[]>("/api/states")
      .then((states) => {
        const value = buildRouterStatus(states, config);
        routerStatusCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        routerStatusRequest = null;
      });
  }

  return routerStatusRequest;
}

export const routerModule: DashboardModule = {
  id: "router",
  title: "Network / Router",
  description: "WAN status, external IP, and up/down throughput for the home router.",
  status(context: ModuleStateContext): ModuleStatus {
    const router = context.config.homeAssistant.router;
    const has = (id: string) => context.states.some((state) => state.entity_id === id);
    const requirements = [
      { ok: has(router.wanStatusEntityId), label: "WAN status sensor", detail: router.wanStatusEntityId },
      { ok: has(router.downloadSpeedEntityId), label: "Download speed sensor", detail: router.downloadSpeedEntityId },
      { ok: has(router.uploadSpeedEntityId), label: "Upload speed sensor", detail: router.uploadSpeedEntityId },
    ];
    return {
      id: this.id,
      title: this.title,
      active: requirements.some((requirement) => requirement.ok),
      summary: `Router "${router.name}"`,
      requirements,
    };
  },
};
