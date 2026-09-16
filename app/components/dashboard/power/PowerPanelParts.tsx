"use client";

import type { ComponentType } from "react";
import type {
  PowerAccountUsagePoint,
  PowerBackgroundEstimatePoint,
  PowerDashboard,
  PowerPoint,
  PowerRatePoint,
} from "../../../../lib/power";
import {
  formatDollarsPerKwh,
  formatKilowatts,
  formatKwh,
  formatKwhPerHour,
  formatMoney,
  pathForPoints,
  type PowerDisplayMode,
} from "../power-format";
import { LabeledSlideSwitch } from "../../SlideSwitch";
import { classNames } from "../shared";

export function CurveChart({
  points,
  formatValue,
  value,
  variant = "usage",
}: {
  points: Array<PowerPoint | PowerRatePoint | PowerAccountUsagePoint>;
  formatValue: (value: number) => string;
  value: (point: PowerPoint | PowerRatePoint | PowerAccountUsagePoint) => number;
  variant?: "usage" | "rate" | "account";
}) {
  const path = pathForPoints(points, value);
  const last = points.at(-1);

  return (
    <div className="power-curve-card border border-neutral-700 bg-neutral-950/70 p-4">
      <svg className="power-curve" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`power-${variant}-stroke`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--cyber-highlight)" />
            <stop offset="62%" stopColor="var(--cyber-line)" />
            <stop offset="100%" stopColor="#ff4fd8" />
          </linearGradient>
        </defs>
        <path className="power-curve-grid" d="M 0 10 H 100 M 0 22 H 100 M 0 34 H 100" />
        {path ? <path className="power-curve-line" d={path} stroke={`url(#power-${variant}-stroke)`} /> : null}
      </svg>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs font-black uppercase text-neutral-400">
        <span>{points[0]?.label ?? "--"}</span>
        <span className="text-neutral-100">{last ? formatValue(value(last)) : "--"}</span>
        <span>{last?.label ?? "--"}</span>
      </div>
    </div>
  );
}

export function MetricCard({
  label,
  primary,
  secondary,
  icon: Icon,
  tone = "cyan",
}: {
  label: string;
  primary: string;
  secondary: string;
  icon: ComponentType<{ className?: string }>;
  tone?: "cyan" | "yellow" | "pink";
}) {
  return (
    <div
      className={classNames(
        "power-metric-card border bg-neutral-950/70 p-4",
        tone === "yellow" && "border-yellow-300/40",
        tone === "pink" && "border-fuchsia-300/40",
        tone === "cyan" && "border-cyan-300/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-black uppercase text-neutral-400">{label}</p>
        <Icon
          className={classNames(
            "h-5 w-5",
            tone === "yellow" && "text-yellow-300",
            tone === "pink" && "text-fuchsia-300",
            tone === "cyan" && "text-cyan-300",
          )}
        />
      </div>
      <p className="mt-3 text-3xl font-black tabular-nums text-neutral-50">{primary}</p>
      <p className="mt-1 text-sm font-semibold uppercase text-neutral-400">{secondary}</p>
    </div>
  );
}

export function CurrentUseStrip({ data }: { data: PowerDashboard | null }) {
  const costPerHour = data ? `${formatMoney(data.currentCostPerHourNzd, 3)}/h` : "--";
  const dollarsPerKwh = data ? formatDollarsPerKwh(data.currentRate.cPerKwh) : "--";
  const kwhPerHour = data ? formatKwhPerHour(data.currentWatts) : "--";
  const watts = data ? `${Math.round(data.currentWatts).toLocaleString()} W` : "--";

  return (
    <div className="power-current-use grid gap-3">
      <div className="power-current-use-cell">
        <span>Current value</span>
        <strong>{costPerHour}</strong>
        <small>{dollarsPerKwh}</small>
      </div>
      <div className="power-current-use-cell">
        <span>Use rate</span>
        <strong>{kwhPerHour}</strong>
        <small>{data ? formatKilowatts(data.currentWatts) : "--"}</small>
      </div>
      <div className="power-current-use-cell">
        <span>Watts</span>
        <strong>{watts}</strong>
        <small>{data?.generatedAt ? "live estimate" : "waiting for sample"}</small>
      </div>
    </div>
  );
}

export function DisplayModeToggle({
  displayMode,
  onDisplayModeChange,
}: {
  displayMode: PowerDisplayMode;
  onDisplayModeChange: (displayMode: PowerDisplayMode) => void;
}) {
  return (
    <div className="mb-5 flex justify-center">
      {/* The surface's one switch, with its own two labels rather than
          Off/On (specs/slide-switch.md). */}
      <LabeledSlideSwitch
        checked={displayMode === "kwh"}
        label="Power display mode"
        leftLabel="Credits"
        rightLabel="kWh"
        onChange={() => onDisplayModeChange(displayMode === "kwh" ? "credits" : "kwh")}
      />
    </div>
  );
}

export function SummaryRow({
  cost,
  kwh,
  label,
  mode,
  projectedCost,
  projectedKwh,
}: {
  cost: number;
  kwh: number;
  label: string;
  mode: PowerDisplayMode;
  projectedCost?: number;
  projectedKwh?: number;
}) {
  const primary = mode === "credits" ? formatMoney(cost) : `${formatKwh(kwh)} kWh`;
  const secondary = mode === "credits" ? `${formatKwh(kwh)} kWh` : formatMoney(cost);
  const projected =
    projectedKwh !== undefined && projectedCost !== undefined
      ? mode === "credits"
        ? `projected ${formatMoney(projectedCost)} / ${formatKwh(projectedKwh)} kWh`
        : `projected ${formatKwh(projectedKwh)} kWh / ${formatMoney(projectedCost)}`
      : null;

  return (
    <div className="power-summary-row grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border border-neutral-800 bg-neutral-900/60 px-3 py-2">
      <span className="min-w-0 truncate text-sm font-black uppercase text-neutral-100">{label}</span>
      <span className="text-right text-sm font-black tabular-nums text-yellow-100">{primary}</span>
      <span className="text-right text-sm font-black tabular-nums text-cyan-100">{secondary}</span>
      {projected ? <span className="col-span-3 text-right text-xs font-semibold uppercase text-neutral-500">{projected}</span> : null}
    </div>
  );
}

export function BackgroundRow({ agentName, point }: { agentName: string; point: PowerBackgroundEstimatePoint }) {
  return (
    <div className="grid grid-cols-[72px_repeat(5,minmax(0,1fr))] gap-2 border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs font-black uppercase">
      <span className="text-neutral-100">{point.label.replace(" 20", " '")}</span>
      <span className="tabular-nums text-cyan-100">F {Math.round(point.fridgeKwh)}</span>
      <span className="tabular-nums text-yellow-100">W {Math.round(point.waterHeaterKwh)}</span>
      <span className="tabular-nums text-fuchsia-100">PC {Math.round(point.computerKwh)}</span>
      <span className="tabular-nums text-lime-100">{agentName.charAt(0).toLocaleUpperCase()} {Math.round(point.novaKwh)}</span>
      <span className="tabular-nums text-neutral-300" title="Unattributed usage">O {Math.round(point.otherKwh)}</span>
    </div>
  );
}
