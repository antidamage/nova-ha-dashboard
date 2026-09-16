"use client";

import { useEffect, useMemo, useState } from "react";
import type { PowerWashingMachineSummary } from "../../../../lib/power";
import { formatKwh, formatMoney, type PowerDisplayMode } from "../power-format";
import { classNames } from "../shared";
import { GRAPH_HEIGHT, GRAPH_WIDTH, WASH_TIMELINE_MS, formatWatts, timelineX } from "./meters-model";

export function WashingMachineCard({
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
          const cycle = summary.running?.id === id ? summary.running : summary.cycles.find((candidate) => candidate.id === id);
          return cycle ? cycle.person !== person : false;
        }),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [summary.cycles, summary.running]);

  const personOf = (cycleId: string, serverPerson: string | null) =>
    cycleId in pending ? pending[cycleId] : serverPerson;

  const colorOf = (person: string | null) =>
    summary.people.find((candidate) => candidate.id === person)?.color ?? "var(--cyber-line, #52525b)";

  const cycles = summary.cycles;
  const now = Date.now();
  const timeline = [
    ...cycles.map((cycle) => ({ ...cycle, active: false })),
    ...(summary.open ? [{
      active: true,
      attribution: summary.running?.attribution ?? summary.open.attribution,
      curve: summary.running?.curve,
      costNzd: summary.open.costNzd,
      endedAt: new Date(now).toISOString(),
      id: summary.running?.id ?? "active",
      kwh: summary.open.kwh,
      person: summary.open.person ?? null,
      startedAt: summary.open.startedAt!,
    }] : []),
  ].filter((cycle) => new Date(cycle.endedAt).getTime() >= now - WASH_TIMELINE_MS);
  const peak = Math.max(0.01, ...timeline.map((cycle) => cycle.kwh));

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

      <div className="power-wash-graph relative border border-neutral-800 bg-neutral-900/60">
        <svg className="power-wash-svg" viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          <path className="power-curve-grid" d={`M 0 10 H ${GRAPH_WIDTH} M 0 20 H ${GRAPH_WIDTH} M 0 30 H ${GRAPH_WIDTH}`} />
        </svg>
        <div className="power-wash-blocks">
          {timeline.length === 0 ? (
            <p className="power-wash-empty text-xs font-black uppercase text-neutral-600">No washes in the last 12 hours</p>
          ) : null}
          {timeline.map((cycle) => {
            const person = personOf(cycle.id, cycle.person);
            const label = summary.people.find((candidate) => candidate.id === person)?.label ?? "Unassigned";
            const start = timelineX(new Date(cycle.startedAt).getTime(), now);
            const end = timelineX(new Date(cycle.endedAt).getTime(), now);
            // A pattern guess is hatched until someone taps it (§5.2).
            const guessed = person !== null && !(cycle.id in pending) && cycle.attribution?.source === "auto";
            const color = colorOf(person);
            const curve = cycle.curve ?? [];
            const curvePeak = Math.max(1, ...curve);
            return (
              // A plain button: the shared press flash painted a cyan box over the
              // block and hid the new person colour for half a second (§7.6).
              <button
                key={cycle.id}
                type="button"
                aria-label={`${cycle.active ? "Active " : ""}${cycle.kwh.toFixed(2)} kWh wash, ${label}${guessed ? " (guessed)" : ""}. Tap to claim or reassign.`}
                className={classNames("power-wash-block", guessed && "is-guessed")}
                onClick={() => void attribute(cycle.id, person)}
                style={{
                  background: guessed ? `repeating-linear-gradient(135deg, ${color} 0 3px, transparent 3px 7px), rgb(10 10 10 / 0.35)` : color,
                  borderColor: guessed ? color : undefined,
                  height: `${Math.max(14, (cycle.kwh / peak) * 100)}%`,
                  left: `${start}%`,
                  width: `${Math.max(14, end - start)}%`,
                }}
                title={`${cycle.active ? "Active — " : ""}${label}${guessed ? " (guessed)" : ""} / ${cycle.kwh.toFixed(2)} kWh`}
              >
                {curve.length > 1 ? (
                  <svg className="power-wash-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <polyline
                      points={curve
                        .map((watts, index) => `${(index / (curve.length - 1)) * 100},${100 - (watts / curvePeak) * 92}`)
                        .join(" ")}
                    />
                  </svg>
                ) : null}
              </button>
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
