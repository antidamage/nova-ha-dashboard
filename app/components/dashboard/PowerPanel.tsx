"use client";

import { Activity, BatteryCharging, ChevronDown, CircleDollarSign, PlugZap } from "lucide-react";
import type { ComponentType } from "react";
import { useMemo, useState } from "react";
import type {
  PowerAccountUsagePoint,
  PowerBackgroundEstimatePoint,
  PowerDashboard,
  PowerPoint,
  PowerRatePoint,
} from "../../../lib/power";
import {
  formatBillingDate,
  formatDollarsPerKwh,
  formatGraphKwh,
  formatKilowatts,
  formatKw,
  formatKwh,
  formatKwhPerHour,
  formatMoney,
  pathForPoints,
  usagePointValue,
  type PowerDisplayMode,
} from "./power-format";
import { classNames } from "./shared";
import { usePowerDashboard } from "./usePowerDashboard";
import { useAgentName } from "../AgentNameContext";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";

function CurveChart({
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

function MetricCard({
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

function CurrentUseStrip({ data }: { data: PowerDashboard | null }) {
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

function DisplayModeToggle({
  displayMode,
  onDisplayModeChange,
}: {
  displayMode: PowerDisplayMode;
  onDisplayModeChange: (displayMode: PowerDisplayMode) => void;
}) {
  return (
    <div className="mb-5 flex justify-center">
      <label className="power-mode-toggle">
        <span className={classNames("power-mode-label", displayMode === "credits" && "is-active")}>Credits</span>
        <input
          aria-label="Power display mode"
          checked={displayMode === "kwh"}
          onChange={(event) => onDisplayModeChange(event.target.checked ? "kwh" : "credits")}
          role="switch"
          type="checkbox"
        />
        <span className="power-mode-track" aria-hidden="true">
          <span className="power-mode-thumb" />
        </span>
        <span className={classNames("power-mode-label", displayMode === "kwh" && "is-active")}>kWh</span>
      </label>
    </div>
  );
}

function SummaryRow({
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

function BackgroundRow({ agentName, point }: { agentName: string; point: PowerBackgroundEstimatePoint }) {
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

export function PowerPanel() {
  const { agentName } = useAgentName();
  const state = usePowerDashboard();
  const [displayMode, setDisplayMode] = useState<PowerDisplayMode>("credits");
  const [baseLoadsExpanded, setBaseLoadsExpanded] = useState(false);

  const data = state.data;
  const topDevices = useMemo(() => data?.devices.slice(0, 8) ?? [], [data?.devices]);
  const backgroundRows = useMemo(() => data?.backgroundEstimateGraph.slice(-12) ?? [], [data?.backgroundEstimateGraph]);
  const accountRatePoints = useMemo(
    () => (data?.accountRateGraph.length ? data.accountRateGraph : data?.rateGraph ?? []),
    [data?.accountRateGraph, data?.rateGraph],
  );

  const rateLabel = data ? `${data.currentRate.cPerKwh.toFixed(2)} c/kWh` : null;
  const chartFormat = displayMode === "credits" ? formatMoney : formatGraphKwh;
  const forecastPrimary =
    displayMode === "credits"
      ? formatMoney(data?.summaries.month.projectedCostNzd ?? 0)
      : `${formatKwh(data?.summaries.month.projectedKwh ?? 0)} kWh`;
  const forecastSecondary =
    displayMode === "credits"
      ? `${formatKwh(data?.summaries.month.projectedKwh ?? 0)} kWh`
      : formatMoney(data?.summaries.month.projectedCostNzd ?? 0);
  const dailyPrimary =
    displayMode === "credits"
      ? formatMoney(data?.summaries.day.projectedCostNzd ?? data?.baseLoad.costPerDayNzd ?? 0)
      : `${formatKwh(data?.summaries.day.projectedKwh ?? data?.baseLoad.kwhPerDay ?? 0)} kWh`;
  const dailySecondary =
    displayMode === "credits"
      ? `${formatKwh(data?.summaries.day.projectedKwh ?? data?.baseLoad.kwhPerDay ?? 0)} kWh / ${formatKw(data?.currentWatts ?? 0)} now`
      : `${formatMoney(data?.summaries.day.projectedCostNzd ?? data?.baseLoad.costPerDayNzd ?? 0)} / ${formatKw(data?.currentWatts ?? 0)} now`;
  const monthToDatePrimary =
    displayMode === "credits" ? formatMoney(data?.summaries.month.costNzd ?? 0) : `${formatKwh(data?.summaries.month.kwh ?? 0)} kWh`;
  const monthToDateSecondary =
    displayMode === "credits" ? `${formatKwh(data?.summaries.month.kwh ?? 0)} kWh used` : `${formatMoney(data?.summaries.month.costNzd ?? 0)} used`;
  const billingWindow = data ? `${formatBillingDate(data.billingCycle.startDate)} - ${formatBillingDate(data.billingCycle.endDate)}` : null;
  const deviceCostRate = data ? data.currentRate.cPerKwh / 100 : 0;

  return (
    <section className="power-panel border border-neutral-700 bg-neutral-950/70 p-5">
      <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase text-cyan-300">Grid Telemetry</p>
          <h2 className="mt-1 text-3xl font-black uppercase text-neutral-50">Estimated Consumption</h2>
        </div>
        <div className="grid gap-2 text-xs font-black uppercase text-neutral-400 lg:text-right">
          {data ? (
            <>
              <span>{data.currentRate.displayName}</span>
              <span>Billing {data.billingCycle.label} / {billingWindow}</span>
              <span className="text-yellow-200">Tariff {data.currentRate.period.replace("_", " ")} / {rateLabel}</span>
              {data.estimation?.lastActualDate ? (
                <span className="text-cyan-200">
                  Powershop calibrated / {data.estimation.historyDays} days / through {formatBillingDate(data.estimation.lastActualDate)} / {data.estimation.halfLifeDays}d recent half-life
                </span>
              ) : null}
              {data.ratesWarning ? <span className="text-red-200">{data.ratesWarning}</span> : null}
            </>
          ) : (
            <span>Waiting for grid sample</span>
          )}
          {state.error ? <span className="text-red-200">{state.error}</span> : null}
        </div>
      </header>

      <CurrentUseStrip data={data} />
      <DisplayModeToggle displayMode={displayMode} onDisplayModeChange={setDisplayMode} />

      {!data ? <p className="text-2xl font-black uppercase text-neutral-50">Charging estimate core</p> : null}

      {data ? <div className="power-metric-grid grid gap-3">
        <MetricCard label="Daily estimate" primary={dailyPrimary} secondary={dailySecondary} icon={PlugZap} />
        <MetricCard
          label="Billing estimate"
          primary={forecastPrimary}
          secondary={forecastSecondary}
          icon={CircleDollarSign}
          tone="yellow"
        />
        <MetricCard
          label="Billing to date"
          primary={monthToDatePrimary}
          secondary={monthToDateSecondary}
          icon={Activity}
          tone="pink"
        />
      </div> : null}

      {data ? <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="grid gap-4">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-black uppercase text-yellow-200">Account usage</p>
              <p className="text-xs font-black uppercase text-neutral-500">{displayMode === "credits" ? "credits" : "kWh"} / Powershop billing cycles</p>
            </div>
            <CurveChart points={data.accountUsageGraph} formatValue={chartFormat} value={(point) => usagePointValue(point, displayMode)} variant="account" />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-black uppercase text-cyan-200">Usage curve</p>
              <p className="text-xs font-black uppercase text-neutral-500">{displayMode === "credits" ? "credits" : "kWh"} / last 36 hours</p>
            </div>
            <CurveChart points={data.graph} formatValue={chartFormat} value={(point) => usagePointValue(point, displayMode)} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-black uppercase text-fuchsia-200">Powershop rate curve</p>
              <p className="text-xs font-black uppercase text-neutral-500">account average unit price</p>
            </div>
            <CurveChart
              points={accountRatePoints}
              formatValue={(value) => `${value.toFixed(2)} c/kWh`}
              value={(point) => ("cPerKwh" in point ? point.cPerKwh : point.kwh)}
              variant="rate"
            />
          </div>

          <div className="power-summary-grid grid gap-2">
            <SummaryRow
              label="Today"
              kwh={data.summaries.day.kwh}
              cost={data.summaries.day.costNzd}
              mode={displayMode}
              projectedKwh={data.summaries.day.projectedKwh}
              projectedCost={data.summaries.day.projectedCostNzd}
            />
            <SummaryRow
              label="Week"
              kwh={data.summaries.week.kwh}
              cost={data.summaries.week.costNzd}
              mode={displayMode}
              projectedKwh={data.summaries.week.projectedKwh}
              projectedCost={data.summaries.week.projectedCostNzd}
            />
            <SummaryRow
              label="Billing month"
              kwh={data.summaries.month.kwh}
              cost={data.summaries.month.costNzd}
              mode={displayMode}
              projectedKwh={data.summaries.month.projectedKwh}
              projectedCost={data.summaries.month.projectedCostNzd}
            />
            <SummaryRow
              label="Year to date"
              kwh={data.summaries.yearToDate.kwh}
              cost={data.summaries.yearToDate.costNzd}
              mode={displayMode}
              projectedKwh={data.summaries.yearToDate.projectedKwh}
              projectedCost={data.summaries.yearToDate.projectedCostNzd}
            />
          </div>
        </div>

        <div className="power-device-list border border-neutral-700 bg-neutral-950/70 p-4">
          <div className="mb-5">
            <MomentaryFeedbackButton
              type="button"
              className="mb-3 flex w-full items-center gap-2 text-left"
              aria-controls="power-inferred-base-loads"
              aria-expanded={baseLoadsExpanded}
              onClick={() => setBaseLoadsExpanded((expanded) => !expanded)}
            >
              <ChevronDown
                className={classNames("h-4 w-4 shrink-0 text-fuchsia-200 transition-transform", baseLoadsExpanded && "rotate-180")}
                aria-hidden="true"
              />
              <span className="flex-1 text-sm font-black uppercase text-fuchsia-200">Inferred base loads</span>
              <span className="text-xs font-black uppercase text-neutral-500">
                {displayMode === "credits" ? formatMoney(data.baseLoad.costPerDayNzd) : `${formatKwh(data.baseLoad.kwhPerDay)} kWh`} / day
              </span>
            </MomentaryFeedbackButton>
            {baseLoadsExpanded ? (
              <div id="power-inferred-base-loads" className="grid gap-2">
                {backgroundRows.map((point) => (
                  <BackgroundRow key={point.label} agentName={agentName} point={point} />
                ))}
              </div>
            ) : null}
          </div>

          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-black uppercase text-yellow-200">Devices</p>
            <BatteryCharging className="h-5 w-5 text-yellow-300" />
          </div>
          <div className="grid gap-2">
            {topDevices.map((device) => (
              <div key={device.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border border-neutral-800 bg-neutral-900/60 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black uppercase text-neutral-100">{device.id === "nova_aio" ? agentName : device.name}</p>
                  <p className="truncate text-xs font-semibold uppercase text-neutral-500">
                    {device.zone} / {device.confidence} / {device.state}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black tabular-nums text-cyan-100">
                    {displayMode === "credits" ? `${formatMoney((device.watts / 1000) * deviceCostRate)} /h` : formatKw(device.watts)}
                  </p>
                  <p className="text-xs font-semibold tabular-nums text-neutral-500">
                    {displayMode === "credits" ? `${formatMoney(device.kwhTotal * deviceCostRate)} est` : `${formatKwh(device.kwhTotal)} kWh`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div> : null}
    </section>
  );
}
