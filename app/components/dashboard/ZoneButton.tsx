"use client";

import { Fan, Gauge, Lightbulb, Thermometer, ToggleLeft } from "lucide-react";
import type { DashboardZone, HaDomain, RouterStatus } from "../../../lib/types";
import { classNames, countDomainsForZone, isNetworkZone, routerStatusLabel } from "./shared";

const domainIcons: Record<HaDomain, React.ComponentType<{ className?: string }>> = {
  light: Lightbulb,
  switch: ToggleLeft,
  climate: Thermometer,
  fan: Fan,
  cover: Gauge,
  humidifier: Gauge,
  sensor: Thermometer,
};

const domainAccent: Record<HaDomain, string> = {
  light: "text-yellow-300 border-yellow-300/40 bg-yellow-300/10",
  switch: "text-cyan-300 border-cyan-300/40 bg-cyan-300/10",
  climate: "text-fuchsia-300 border-fuchsia-300/40 bg-fuchsia-300/10",
  fan: "text-emerald-300 border-emerald-300/40 bg-emerald-300/10",
  cover: "text-orange-300 border-orange-300/40 bg-orange-300/10",
  humidifier: "text-sky-300 border-sky-300/10 bg-sky-300/10",
  sensor: "text-cyan-300 border-cyan-300/40 bg-cyan-300/10",
};

export function StatChip({ domain, count }: { domain: HaDomain; count: number }) {
  const Icon = domainIcons[domain];

  return (
    <div
      className={classNames(
        "flex h-11 min-w-0 items-center gap-2 border px-3 text-sm font-semibold uppercase",
        domainAccent[domain],
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{domain.replace("_", " ")}</span>
      <span className="ml-auto tabular-nums">{count}</span>
    </div>
  );
}

export function ZoneButton({
  zone,
  selected,
  onClick,
  nested = false,
  hideCounts = false,
  domains,
  routerStatus,
  className,
}: {
  zone: DashboardZone;
  selected: boolean;
  onClick: () => void;
  nested?: boolean;
  hideCounts?: boolean;
  domains?: HaDomain[];
  routerStatus?: RouterStatus;
  className?: string;
}) {
  const countDomains = domains ?? countDomainsForZone(zone);
  const networkStatus = isNetworkZone(zone) ? routerStatusLabel(routerStatus) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "zone-button group relative flex min-h-24 w-full flex-col justify-between overflow-hidden border bg-neutral-900/80 p-4 text-left outline-none transition",
        nested && "zone-button-child min-h-20 py-3 pl-6",
        selected && "zone-button-selected",
        className,
        selected
          ? "border-cyan-300 shadow-[0_0_0_1px_rgba(103,232,249,0.5),0_0_26px_rgba(103,232,249,0.16)]"
          : "border-neutral-700 hover:border-fuchsia-300/80",
      )}
    >
      <span className="pointer-events-none absolute right-0 top-0 h-5 w-16 border-b border-l border-cyan-300/20" />
      <span className="flex items-start justify-between gap-3">
        <span className="zone-title-bar min-w-0 flex-1 truncate text-lg font-black uppercase">
          {zone.name}
        </span>
      </span>
      {networkStatus ? (
        <span className="zone-counts mt-3 grid gap-2 text-xs font-semibold text-neutral-400">
          <span>{networkStatus}</span>
        </span>
      ) : hideCounts || countDomains.length === 0 ? null : (
        <span
          className="zone-counts mt-3 grid gap-2 text-xs font-semibold text-neutral-400"
          style={{ gridTemplateColumns: `repeat(${countDomains.length}, minmax(0, 1fr))` }}
        >
          {countDomains.map((domain) => (
            <span key={domain}>
              {zone.counts[domain]} {domain === "light" ? "lights" : domain === "switch" ? "switches" : domain}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
