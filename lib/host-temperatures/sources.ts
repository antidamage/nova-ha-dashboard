/**
 * Host temperature sources and readings (specs/host-temperature-gauges.md).
 *
 * A source is one `Label=URL` token from a Host Temperatures preset's
 * `metricSources` binding: a short label for the machine and the URL of its
 * host-metrics `/flat` endpoint. No machine is named in source; every one comes
 * from configuration.
 */

export type MetricSource = { label: string; url: string };

/** One gauge: a machine's CPU or a GPU, in whole degrees Celsius. */
export type TemperatureReading = { key: string; part: string; celsius: number };

export type SourceTemperatures = {
  url: string;
  label: string;
  ok: boolean;
  readings: TemperatureReading[];
};

export type HostTemperaturesResponse = { sources: SourceTemperatures[]; at: number };

/** `Label=URL` tokens, in order; anything without both halves, or not http(s), is dropped. */
export function parseMetricSources(tokens: readonly string[] | undefined): MetricSource[] {
  const sources: MetricSource[] = [];
  for (const token of tokens ?? []) {
    const at = token.indexOf("=");
    if (at <= 0) continue;
    const label = token.slice(0, at).trim();
    const url = token.slice(at + 1).trim();
    if (!label || !/^https?:\/\/\S+$/i.test(url)) continue;
    if (!sources.some((s) => s.url === url && s.label === label)) sources.push({ label, url });
  }
  return sources;
}

const READING_KEY = /^temp\.(cpu|gpu)(?:\.(\d+))?\.celsius$/;

/**
 * The temperature readings in one host-metrics `/flat` document, CPU first and
 * then each GPU in index order. Non-numeric values are left out, never zero.
 */
export function readingsFromFlat(flat: unknown): TemperatureReading[] {
  if (!flat || typeof flat !== "object") return [];
  const found: (TemperatureReading & { order: number })[] = [];
  for (const [key, value] of Object.entries(flat as Record<string, unknown>)) {
    const match = READING_KEY.exec(key);
    if (!match || typeof value !== "number" || !Number.isFinite(value)) continue;
    const [, kind, index] = match;
    const part = kind === "cpu" ? "CPU" : index === undefined ? "GPU" : `GPU ${index}`;
    const order = kind === "cpu" ? -1 : Number(index ?? 0);
    found.push({ key, part, celsius: Math.round(value), order });
  }
  return found.sort((a, b) => a.order - b.order).map(({ key, part, celsius }) => ({ key, part, celsius }));
}

/**
 * Too hot, in whole degrees: the ring turns red and its glow pulses
 * (specs/host-temperature-gauges.md, "Too hot"). A GPU from 84 C, the RTX
 * cards' own temperature target (both hosts' cards hold there under load); a
 * CPU from 90 C, 5 C under the Ryzen 9 3900X's 95 C limit.
 */
export const HOT_CELSIUS = { CPU: 90, GPU: 84 } as const;

/** The fill at which a part reaches its hot temperature (alex, 2026-11-22). */
export const HOT_FILL = 0.9;

function hotCelsius(part: string): number {
  return part.startsWith("GPU") ? HOT_CELSIUS.GPU : HOT_CELSIUS.CPU;
}

/** The temperature of a full ring: the part's hot temperature over HOT_FILL. */
export function gaugeFullCelsius(part: string): number {
  return hotCelsius(part) / HOT_FILL;
}

export function gaugeIsHot(part: string, celsius: number | null | undefined): boolean {
  if (celsius === null || celsius === undefined || !Number.isFinite(celsius)) return false;
  return celsius >= hotCelsius(part);
}

/**
 * How full the ring is: 0 C empty, the part's hot temperature at 90%, so a
 * ring that flashes red is nearly full (alex, 2026-11-22: "a half- or
 * three-quarter- full gauge flashing is going to seem like a false alarm").
 * Full is hot / 0.9: 100 C for a CPU, ~93 C for a GPU. Clamped to 0..1.
 */
export function gaugeFraction(part: string, celsius: number | null | undefined): number {
  if (celsius === null || celsius === undefined || !Number.isFinite(celsius)) return 0;
  return Math.min(1, Math.max(0, (celsius * HOT_FILL) / hotCelsius(part)));
}
