import type {
  PowerAccountUsagePoint,
  PowerPoint,
  PowerRatePoint,
} from "../../../lib/power";

export type PowerDisplayMode = "credits" | "kwh";

const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatKw(watts: number) {
  if (watts >= 1000) {
    return `${(watts / 1000).toFixed(2)} kW`;
  }
  return `${Math.round(watts)} W`;
}

export function formatKilowatts(watts: number) {
  return `${(watts / 1000).toFixed(2)} kW`;
}

export function formatKwh(value: number) {
  if (value >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

export function formatMoney(value: number, digits = 2) {
  return `$${value.toFixed(digits)}`;
}

export function formatDollarsPerKwh(cPerKwh: number) {
  return `$${(cPerKwh / 100).toFixed(4)}/kWh`;
}

export function formatKwhPerHour(watts: number) {
  return `${(watts / 1000).toFixed(watts >= 1000 ? 2 : 3)} kWh/h`;
}

export function formatBillingDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return value;
  }
  return `${day} ${shortMonths[Math.max(0, Math.min(11, month - 1))]}`;
}

export function formatGraphKwh(value: number) {
  return `${formatKwh(value)} kWh`;
}

export function usagePointValue(point: PowerPoint | PowerRatePoint | PowerAccountUsagePoint, mode: PowerDisplayMode) {
  if (mode === "credits" && "costNzd" in point && typeof point.costNzd === "number") {
    return point.costNzd;
  }
  return "kwh" in point ? point.kwh : point.cPerKwh;
}

export function pathForPoints<T extends { label: string }>(points: T[], value: (point: T) => number) {
  if (points.length < 2) {
    return "";
  }

  const values = points.map(value);
  const max = Math.max(...values, 0.001);
  const width = 100;
  const height = 38;
  const step = width / (points.length - 1);
  const coords = points.map((point, index) => ({
    x: index * step,
    y: height - (value(point) / max) * height,
  }));

  return coords
    .map((point, index) => {
      if (index === 0) {
        return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
      }
      const previous = coords[index - 1];
      const midX = (previous.x + point.x) / 2;
      return `C ${midX.toFixed(2)} ${previous.y.toFixed(2)}, ${midX.toFixed(2)} ${point.y.toFixed(2)}, ${point.x.toFixed(
        2,
      )} ${point.y.toFixed(2)}`;
    })
    .join(" ");
}
