"use client";

import { useEffect, useMemo, useState } from "react";
import type { PowerWashingMachineSummary } from "../../../../../lib/power";
import { formatKwh, formatMoney, type PowerDisplayMode } from "../../power-format";
import { formatWatts } from "../meters-model";
import { WashTimeline } from "./WashTimeline";
import { useWashHistory } from "./useWashHistory";
import { personColor, washStep } from "./wash-timeline";

/**
 * The washing machine's card: a 12-hour block of washes (WashTimeline) that can
 * be stepped back through the machine's stored history, the attribution a tap on
 * a block performs, and the month's sub-totals.
 *
 * The graph's own data comes from the history endpoint, not from the dashboard
 * payload, because a wash can be reattributed long after the month it happened
 * in (the store keeps 400 days of them). See specs/power-meters.md 5.2.
 */
export function WashingMachineCard({
  displayMode,
  summary,
}: {
  displayMode: PowerDisplayMode;
  summary: PowerWashingMachineSummary;
}) {
  const [pending, setPending] = useState<Record<string, string | null>>({});
  // The block on show. `null` is the newest block, which follows the poll.
  const [cursor, setCursor] = useState<number | null>(null);
  const { blocks, error, history } = useWashHistory({ blockMs: cursor });
  const viewed = history?.cycles;

  // A pending attribution is dropped the moment the server agrees with it — and
  // the polled summary is not the only server: it carries this calendar month's
  // washes, while the graph steps back through 400 days, so a tap on a wash from
  // an earlier month is echoed by that block's own read instead. Consulting the
  // summary alone would drop the tap on the next poll and put the wash's old
  // person back on screen until the graph re-read it.
  useEffect(() => {
    setPending((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([id, person]) => {
          const cycle =
            summary.running?.id === id
              ? summary.running
              : summary.cycles.find((candidate) => candidate.id === id) ??
                viewed?.find((candidate) => candidate.id === id);
          return cycle ? cycle.person !== person : false;
        }),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [summary.cycles, summary.running, viewed]);

  const personOf = (cycleId: string, serverPerson: string | null) =>
    cycleId in pending ? pending[cycleId] : serverPerson;

  const cycles = summary.cycles;

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

  const step = (direction: -1 | 1) => {
    const target = washStep(blocks, cursor, direction);
    if (target !== undefined) setCursor(target);
  };

  const attribute = async (cycleId: string, current: string | null) => {
    const ids = summary.people.map((person) => person.id);
    const index = current === null ? -1 : ids.indexOf(current);
    const next = ids.length === 0 ? null : index === -1 ? ids[0] : index === ids.length - 1 ? null : ids[index + 1];
    setPending((state) => ({ ...state, [cycleId]: next }));
    try {
      const response = await fetch("/api/power/washing-machine", {
        body: JSON.stringify(cycleId === "active" ? { active: true } : { cycleId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Wash claim failed");
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
        <p className="text-sm font-black tabular-nums text-neutral-100">{summary.open ? `${formatWatts(summary.watts)} now` : monthTotal}</p>
      </header>

      <WashTimeline
        block={history?.window ?? null}
        blocks={blocks}
        cursor={cursor}
        cycles={history?.cycles ?? []}
        error={error}
        isPending={(cycleId) => cycleId in pending}
        onClaim={attribute}
        onStep={step}
        people={summary.people}
        personOf={personOf}
      />

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
                <span className="power-wash-swatch" style={{ background: personColor(summary.people, person) }} aria-hidden="true" />
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
