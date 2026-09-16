"use client";

import { Activity, BatteryCharging, ChevronDown, CircleDollarSign, PlugZap } from "lucide-react";
import { useMemo, useState } from "react";
import {
  formatBillingDate,
  formatGraphKwh,
  formatKw,
  formatKwh,
  formatMoney,
  usagePointValue,
  type PowerDisplayMode,
} from "../power-format";
import { AdvancedFold } from "../AdvancedFold";
import { classNames } from "../shared";
import { usePowerDashboard } from "../usePowerDashboard";
import { useAgentName } from "../../AgentNameContext";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { PowerMeters } from "./PowerMeters";
import {
  BackgroundRow,
  CurrentUseStrip,
  CurveChart,
  DisplayModeToggle,
  MetricCard,
  SummaryRow,
} from "./PowerPanelParts";

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
    <AdvancedFold
      className="power-panel border border-neutral-700 bg-neutral-950/70 p-5"
      advanced={
        data ? (
          <>
            <div className="advanced-fold-row power-tariff-text grid gap-2 text-xs font-black uppercase text-neutral-400">
              <span>{data.currentRate.displayName}</span>
              <span>Billing {data.billingCycle.label} / {billingWindow}</span>
              <span className="text-yellow-200">Tariff {data.currentRate.period.replace("_", " ")} / {rateLabel}</span>
              {data.estimation?.lastActualDate ? (
                <span className="text-cyan-200">
                  Powershop calibrated / {data.estimation.historyDays} days / through {formatBillingDate(data.estimation.lastActualDate)} / {data.estimation.halfLifeDays}d recent half-life
                </span>
              ) : null}
              {data.ratesWarning ? <span className="text-red-200">{data.ratesWarning}</span> : null}
            </div>

            <div className="advanced-fold-row power-metric-grid grid gap-3">
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
            </div>

            <div className="advanced-fold-row power-summary-grid grid gap-2">
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

            <div className="advanced-fold-row power-device-list border border-neutral-700 bg-neutral-950/70 p-4">
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
          </>
        ) : null
      }
    >

      <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase text-cyan-300">Grid Telemetry</p>
          <h2 className="mt-1 text-3xl font-black uppercase text-neutral-50">Estimated Consumption</h2>
        </div>
        {state.error ? <span className="text-xs font-black uppercase text-red-200">{state.error}</span> : null}
      </header>

      <CurrentUseStrip data={data} />
      <DisplayModeToggle displayMode={displayMode} onDisplayModeChange={setDisplayMode} />

      {!data ? <p className="text-2xl font-black uppercase text-neutral-50">Charging estimate core</p> : null}

      {data ? <div className="power-metric-grid grid gap-3">
        <MetricCard label="Daily estimate" primary={dailyPrimary} secondary={dailySecondary} icon={PlugZap} />
      </div> : null}

      {/* The metering plugs, in the main part of the panel. specs/power-meters.md section 5. */}
      {data ? (
        <PowerMeters
          displayMode={displayMode}
          floatingMeter={data.floatingMeter}
          washingMachine={data.washingMachine}
        />
      ) : null}

      {data ? <div className="mt-5 grid gap-4">
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
      </div> : null}
    </AdvancedFold>
  );
}
