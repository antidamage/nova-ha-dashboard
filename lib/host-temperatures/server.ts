import { storedPresets } from "../control-modules/stored";
import type { DashboardConfig } from "../config-schema";
import { readDashboardConfig } from "../dashboard-config";
import {
  parseMetricSources,
  readingsFromFlat,
  type HostTemperaturesResponse,
  type MetricSource,
  type SourceTemperatures,
} from "./sources";

/**
 * The server half of the host temperature gauges (specs/host-temperature-gauges.md).
 *
 * Only URLs saved in a Host Temperatures preset are ever fetched: the request
 * carries no URL, so the route cannot be pointed anywhere else. Each distinct
 * source is fetched once per poll with a 2 s budget, and the whole answer is
 * cached for 5 s so several screens polling at once cost one round of requests.
 */

export const HOST_TEMPERATURES_MODULE_ID = "host-temperatures";
const FETCH_TIMEOUT_MS = 2000;
const CACHE_MS = 5000;

let cached: { until: number; body: HostTemperaturesResponse } | null = null;

export function configuredSources(config: DashboardConfig): MetricSource[] {
  const sources: MetricSource[] = [];
  for (const preset of storedPresets(config)) {
    if (preset.moduleId !== HOST_TEMPERATURES_MODULE_ID) continue;
    for (const source of parseMetricSources(preset.binding.metricSources)) {
      if (!sources.some((s) => s.url === source.url && s.label === source.label)) sources.push(source);
    }
  }
  return sources;
}

async function readSource(source: MetricSource, fetchImpl: typeof fetch): Promise<SourceTemperatures> {
  try {
    const response = await fetchImpl(source.url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return { ...source, ok: false, readings: [] };
    return { ...source, ok: true, readings: readingsFromFlat(await response.json()) };
  } catch {
    return { ...source, ok: false, readings: [] };
  }
}

export async function hostTemperatures(
  options: { now?: number; fetchImpl?: typeof fetch; config?: DashboardConfig } = {},
): Promise<HostTemperaturesResponse> {
  const now = options.now ?? Date.now();
  if (cached && cached.until > now && !options.fetchImpl) return cached.body;
  const config = options.config ?? (await readDashboardConfig());
  const fetchImpl = options.fetchImpl ?? fetch;
  const sources = await Promise.all(configuredSources(config).map((s) => readSource(s, fetchImpl)));
  const body = { sources, at: now };
  if (!options.fetchImpl) cached = { until: now + CACHE_MS, body };
  return body;
}
