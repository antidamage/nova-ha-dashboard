"use client";

import { PlugZap } from "lucide-react";
import type { DashboardZone, RouterStatus } from "../../../lib/types";
import { classNames, isClimateZone, isNetworkZone, isPowerZone, isWorldZone, routerStatusLabel } from "./shared";

function zoneTooltip(zone: DashboardZone, nested: boolean) {
  if (isClimateZone(zone)) {
    return { title: "Climate", text: "Open air conditioner and heater controls." };
  }
  if (isNetworkZone(zone)) {
    return { title: "Network", text: "View router, WAN, and Wi-Fi status." };
  }
  if (isPowerZone(zone)) {
    return { title: "Grid", text: "View power use and billing estimates." };
  }
  if (isWorldZone(zone)) {
    return { title: "World", text: "Open the live map, radar, and satellite view." };
  }
  if (zone.special === "tasks" || zone.id === "tasks") {
    return { title: "Reminders", text: "Open task and reminder management." };
  }
  if (zone.special === "voice" || zone.id === "voice") {
    return { title: "Voice", text: "Open the voice agent status and transcript." };
  }

  return {
    title: zone.name,
    text: nested ? "Select this sub-zone for focused controls." : "Select this zone to view controls.",
  };
}

export function ZoneButton({
  zone,
  selected,
  onClick,
  nested = false,
  routerStatus,
  className,
}: {
  zone: DashboardZone;
  selected: boolean;
  onClick: () => void;
  nested?: boolean;
  routerStatus?: RouterStatus;
  className?: string;
}) {
  const networkStatus = isNetworkZone(zone) ? routerStatusLabel(routerStatus) : null;
  const powerZone = isPowerZone(zone);
  const tooltip = zoneTooltip(zone, nested);

  return (
    <button
      type="button"
      onClick={onClick}
      /* Picking a zone is a section change, not a plain button press
         (specs/ux-sounds.md, "Precedence"). */
      data-ux-sound="sectionChange"
      data-demo-tooltip-title={tooltip.title}
      data-demo-tooltip={tooltip.text}
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
      ) : powerZone ? (
        <span className="zone-counts mt-3 flex items-center gap-2 text-xs font-semibold uppercase text-yellow-200">
          <PlugZap className="h-4 w-4" />
          <span>Live kWh</span>
        </span>
      ) : null}
    </button>
  );
}
