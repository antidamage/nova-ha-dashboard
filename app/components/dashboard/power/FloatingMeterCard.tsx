"use client";

import { CookingPot, Monitor, Plug, Tv, WashingMachine } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import type { PowerFloatingMeterSummary } from "../../../../lib/power";
import type { FloatingMeterCategoryReading } from "../../../../lib/power/floating-meter";
import { ConfigSelect } from "../../ConfigSelect";
import { classNames } from "../shared";
import { formatWatts } from "./meters-model";

const CATEGORY_ICONS: Record<FloatingMeterCategoryReading["icon"], ComponentType<{ className?: string }>> = {
  computers: Monitor,
  entertainment: Tv,
  kitchen: CookingPot,
  laundry: WashingMachine,
  other: Plug,
};

/** How much a category's number is worth, at a glance. */
const CONFIDENCE_LABEL: Record<FloatingMeterCategoryReading["confidence"], string> = {
  measured: "measured",
  high: "learned",
  medium: "learned avg",
  assumed: "estimated",
};

export function FloatingMeterCard({ summary }: { summary: PowerFloatingMeterSummary }) {
  const [pending, setPending] = useState<string | null>(null);

  // Drop the optimistic choice as soon as the server reports it, so a failed
  // move falls back to the truth rather than sticking on screen.
  useEffect(() => {
    if (pending && summary.activeCategoryId === pending) {
      setPending(null);
    }
  }, [pending, summary.activeCategoryId]);

  const activeId = pending ?? summary.activeCategoryId ?? summary.categories[0]?.id ?? "";

  const options = useMemo(
    () =>
      summary.categories.map((category) => {
        const Icon = CATEGORY_ICONS[category.icon] ?? Plug;
        return {
          value: category.id,
          label: category.label,
          detail: category.members.join(", ") || undefined,
          icon: <Icon className="h-4 w-4" />,
        };
      }),
    [summary.categories],
  );

  const move = async (categoryId: string) => {
    setPending(categoryId);
    try {
      await fetch("/api/power/floating-meter", {
        body: JSON.stringify({ categoryId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    } catch {
      setPending(null);
    }
  };

  return (
    <section className="power-meter-card border border-neutral-700 bg-neutral-950/70 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-sm font-black uppercase text-cyan-200">Floating Meter</p>
        <p className="text-sm font-black tabular-nums text-neutral-100">{formatWatts(summary.watts)}</p>
      </header>

      <ConfigSelect
        ariaLabel="What the floating meter is measuring"
        onChange={move}
        options={options}
        value={activeId}
      />

      <div className="power-meter-rows mt-3 grid gap-1">
        {summary.categories.map((category) => {
          const Icon = CATEGORY_ICONS[category.icon] ?? Plug;
          const live = category.id === activeId;
          return (
            <div
              key={category.id}
              className={classNames(
                "power-meter-row grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border border-neutral-800 bg-neutral-900/60 px-2 py-1.5",
                live && "is-live border-cyan-300/40",
              )}
            >
              <Icon className={classNames("h-4 w-4 shrink-0", live ? "text-cyan-200" : "text-neutral-500")} />
              <div className="min-w-0">
                <p className="truncate text-xs font-black uppercase text-neutral-100">{category.label}</p>
                <p className="truncate text-[10px] font-semibold uppercase text-neutral-500">
                  {CONFIDENCE_LABEL[category.confidence]}
                  {category.confidence === "measured" ? "" : ` / ${category.measuredHours}h seen`}
                </p>
              </div>
              <p className="text-right text-xs font-black tabular-nums text-neutral-100">
                {formatWatts(category.watts)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
