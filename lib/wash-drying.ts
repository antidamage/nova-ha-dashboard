import type { WashingMachineConfig } from "./config-schema";
type Settings = NonNullable<WashingMachineConfig["completionAlert"]>["drying"];
const finite = (value: unknown): number | null => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;

/** A dry window recommendation, not an estimate of when the clothes will be dry. */
export function dryingRecommendation(forecast: Record<string, unknown>[], sun: { state: string; nextSetting?: unknown }, at: number, precipitationUnit: string, config: Settings): string {
  const no = (reason: string) => `Hang it outside: No — ${reason}.`;
  const sunset = typeof sun.nextSetting === "string" ? Date.parse(sun.nextSetting) : NaN;
  if (!Number.isFinite(sunset)) return no("I can't confirm a dry window");
  if (sun.state !== "above_horizon" || sunset - at < config.daylightHours * 3_600_000) return no("not enough daylight remaining");
  const rows = forecast.map((row) => ({ row, time: Date.parse(String(row.datetime)) })).sort((a, b) => a.time - b.time);
  // HA providers commonly begin at the next hourly boundary.
  const start = [...rows].reverse().find((row) => row.time <= at) ?? rows.find((row) => row.time <= at + 3_600_000);
  if (!start || at - start.time > 3_600_000) return no("I can't confirm a dry window");
  const selected = rows.filter((row) => row.time >= start.time && row.time < at + config.hours * 3_600_000);
  if (!selected.length || selected[selected.length - 1].time + 3_600_000 < at + config.hours * 3_600_000) return no("I can't confirm a dry window");
  for (let i = 0; i < selected.length; i++) {
    const { row, time } = selected[i];
    if (i && time - selected[i - 1].time > 3_600_000) return no("I can't confirm a dry window");
    const raw = finite(row.precipitation);
    const mm = precipitationUnit === "mm" ? raw : precipitationUnit === "in" && raw !== null ? raw * 25.4 : null;
    if (mm === null) return no("I can't confirm a dry window");
    const chance = finite(row.precipitation_probability);
    if (mm > config.maxRainMm || (chance !== null && chance >= config.maxRainChancePct) || /rain|pouring|snow|hail|lightning/.test(String(row.condition))) return no(`rain or wet weather is forecast in the next ${config.hours} hours`);
  }
  return `Hang it outside: Yes — a dry ${config.hours}-hour window is forecast with enough daylight remaining.`;
}
