"use client";

import { gaugeIsHot, type MetricSource, type SourceTemperatures } from "../../../../lib/host-temperatures/sources";
import { TemperatureGauge } from "./TemperatureGauge";
import { HOST_TEMPS_STALE_MS, useHostTemperatures } from "./useHostTemperatures";

/**
 * The Host Temperatures line (specs/host-temperature-gauges.md): every CPU and
 * GPU reading of each configured machine, as small rings spread evenly across
 * the line. A machine that does not answer keeps its gauges, dimmed, so the
 * row never re-flows.
 */

export type GaugeCell = { key: string; label: string; celsius: number | null; dim: boolean; hot: boolean };

/** Before a machine has answered once, assume a CPU and a GPU so the row has its shape. */
const PLACEHOLDER_PARTS = ["CPU", "GPU"];

export function gaugeCells(
  sources: MetricSource[],
  answered: SourceTemperatures[] | undefined,
  stale: boolean,
  remembered: Map<string, string[]> = new Map(),
): GaugeCell[] {
  const cells: GaugeCell[] = [];
  for (const source of sources) {
    const result = answered?.find((r) => r.url === source.url && r.label === source.label);
    const id = `${source.label}|${source.url}`;
    if (result?.ok && !result.readings.length) {
      remembered.set(id, []); // answers, but publishes no temperatures: no gauges
      continue;
    }
    if (result?.ok) {
      remembered.set(id, result.readings.map((r) => r.part));
      for (const reading of result.readings) {
        cells.push({ key: `${id}|${reading.key}`, label: `${source.label} ${reading.part}`, celsius: reading.celsius, dim: stale, hot: gaugeIsHot(reading.part, reading.celsius) });
      }
      continue;
    }
    for (const part of remembered.get(id) ?? PLACEHOLDER_PARTS) {
      cells.push({ key: `${id}|${part}`, label: `${source.label} ${part}`, celsius: null, dim: true, hot: false });
    }
  }
  return cells;
}

const rememberedParts = new Map<string, string[]>();

export function QuickHostTempsSegment({ title, sources }: { title: string; sources: MetricSource[] }) {
  const { data, receivedAt, now } = useHostTemperatures(sources.length > 0);
  const stale = receivedAt === null || now - receivedAt > HOST_TEMPS_STALE_MS;
  const cells = gaugeCells(sources, data?.sources, stale, rememberedParts);
  return (
    <div className="quick-segment quick-segment-gauges" aria-label={title} role="group">
      {cells.map((cell) => (
        <TemperatureGauge key={cell.key} label={cell.label} celsius={cell.celsius} dim={cell.dim} hot={cell.hot} />
      ))}
    </div>
  );
}
