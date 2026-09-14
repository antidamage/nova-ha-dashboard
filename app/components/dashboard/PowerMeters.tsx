"use client";

import { CookingPot, Monitor, Plug, Tv, WashingMachine } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import type {
  PowerFloatingMeterSummary,
  PowerWashingMachineSummary,
} from "../../../lib/power";
import type { FloatingMeterCategoryReading } from "../../../lib/power-floating-meter";
import { ConfigSelect } from "../ConfigSelect";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { formatKwh, formatMoney, type PowerDisplayMode } from "./power-format";
import { classNames } from "./shared";

/**
 * The two metering plugs, in the main part of the Grid panel.
 *
 * Kept in its own file rather than inlined into PowerPanel: the panel is a
 * shared surface under frequent edit, and these two cards have no business
 * widening its diff. See specs/power-meters.md §5.
 */

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

function formatWatts(watts: number | null) {
  return watts === null ? "--" : `${Math.round(watts).toLocaleString()} W`;
}

function FloatingMeterCard({ summary }: { summary: PowerFloatingMeterSummary }) {
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

const GRAPH_WIDTH = 100;
const GRAPH_HEIGHT = 40;

function daysInMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dayOfMonth(iso: string) {
  return Number(iso.slice(8, 10));
}

function WashingMachineCard({
  displayMode,
  summary,
}: {
  displayMode: PowerDisplayMode;
  summary: PowerWashingMachineSummary;
}) {
  const [pending, setPending] = useState<Record<string, string | null>>({});

  // A pending attribution is dropped the moment the server agrees with it.
  useEffect(() => {
    setPending((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([id, person]) => {
          const cycle = summary.cycles.find((candidate) => candidate.id === id);
          return cycle ? cycle.person !== person : false;
        }),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [summary.cycles]);

  const personOf = (cycleId: string, serverPerson: string | null) =>
    cycleId in pending ? pending[cycleId] : serverPerson;

  const colorOf = (person: string | null) =>
    summary.people.find((candidate) => candidate.id === person)?.color ?? "var(--cyber-line, #52525b)";

  const cycles = summary.cycles;
  const days = daysInMonth(summary.monthKey);
  const peak = Math.max(0.01, ...cycles.map((cycle) => cycle.kwh));

  // Totals are recomputed on the client so an optimistic tap moves them at
  // once; the server's own totals arrive on the next poll and agree.
  const totals = useMemo(() => {
    const rows = new Map<string | null, { costNzd: number; kwh: number }>();
    for (const person of [...summary.people.map((candidate) => candidate.id), null]) {
      rows.set(person, { costNzd: 0, kwh: 0 });
    }
    for (const cycle of cycles) {
      const person = personOf(cycle.id, cycle.person);
      const row = rows.get(person && rows.has(person) ? person : null)!;
      row.costNzd += cycle.costNzd;
      row.kwh += cycle.kwh;
    }
    return rows;
  }, [cycles, pending, summary.people]);

  const monthKwh = cycles.reduce((sum, cycle) => sum + cycle.kwh, 0);
  const monthCost = cycles.reduce((sum, cycle) => sum + cycle.costNzd, 0);
  const monthTotal = displayMode === "credits" ? formatMoney(monthCost) : `${formatKwh(monthKwh)} kWh`;

  const attribute = async (cycleId: string, current: string | null) => {
    const ids = summary.people.map((person) => person.id);
    const index = current === null ? -1 : ids.indexOf(current);
    const next = ids.length === 0 ? null : index === -1 ? ids[0] : index === ids.length - 1 ? null : ids[index + 1];
    setPending((state) => ({ ...state, [cycleId]: next }));
    try {
      await fetch("/api/power/washing-machine", {
        body: JSON.stringify({ cycleId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    } catch {
      setPending((state) => {
        const { [cycleId]: _dropped, ...rest } = state;
        return rest;
      });
    }
  };

  return (
    <section className="power-meter-card border border-neutral-700 bg-neutral-950/70 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-sm font-black uppercase text-fuchsia-200">Washing Machine</p>
        <p className="text-sm font-black tabular-nums text-neutral-100">{monthTotal}</p>
      </header>

      <div className="power-wash-graph relative border border-neutral-800 bg-neutral-900/60">
        <svg className="power-wash-svg" viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          <path className="power-curve-grid" d={`M 0 10 H ${GRAPH_WIDTH} M 0 20 H ${GRAPH_WIDTH} M 0 30 H ${GRAPH_WIDTH}`} />
        </svg>
        <div className="power-wash-blocks">
          {cycles.length === 0 ? (
            <p className="power-wash-empty text-xs font-black uppercase text-neutral-600">No washes this month</p>
          ) : null}
          {cycles.map((cycle) => {
            const person = personOf(cycle.id, cycle.person);
            const label = summary.people.find((candidate) => candidate.id === person)?.label ?? "Unassigned";
            return (
              <MomentaryFeedbackButton
                key={cycle.id}
                type="button"
                aria-label={`${cycle.kwh.toFixed(2)} kWh wash on day ${dayOfMonth(cycle.endedAt)}, ${label}. Tap to reassign.`}
                className="power-wash-block"
                onClick={() => void attribute(cycle.id, person)}
                style={{
                  background: colorOf(person),
                  height: `${Math.max(14, (cycle.kwh / peak) * 100)}%`,
                  left: `${((dayOfMonth(cycle.endedAt) - 0.5) / days) * 100}%`,
                }}
                title={`${label} / ${cycle.kwh.toFixed(2)} kWh`}
              />
            );
          })}
        </div>
      </div>

      {summary.people.length > 0 ? (
        <div className="power-wash-totals mt-3 grid gap-1">
          {[...summary.people.map((person) => person.id), null].map((person) => {
            const row = totals.get(person) ?? { costNzd: 0, kwh: 0 };
            const who = summary.people.find((candidate) => candidate.id === person);
            return (
              <div
                key={person ?? "unassigned"}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border border-neutral-800 bg-neutral-900/60 px-2 py-1.5"
              >
                <span className="power-wash-swatch" style={{ background: colorOf(person) }} aria-hidden="true" />
                <span className="truncate text-xs font-black uppercase text-neutral-100">
                  {who?.label ?? "Unassigned"}
                </span>
                <span className="text-right text-xs font-black tabular-nums text-neutral-100">
                  {displayMode === "credits" ? formatMoney(row.costNzd) : `${formatKwh(row.kwh)} kWh`}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export function PowerMeters({
  displayMode,
  floatingMeter,
  washingMachine,
}: {
  displayMode: PowerDisplayMode;
  floatingMeter?: PowerFloatingMeterSummary;
  washingMachine?: PowerWashingMachineSummary;
}) {
  if (!floatingMeter && !washingMachine) {
    return null;
  }
  return (
    <div className="power-meter-grid mt-5 grid gap-3">
      {washingMachine ? <WashingMachineCard displayMode={displayMode} summary={washingMachine} /> : null}
      {floatingMeter ? <FloatingMeterCard summary={floatingMeter} /> : null}
    </div>
  );
}
