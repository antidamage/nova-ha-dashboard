import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { readWashDetail } from "../../../lib/power";
import { washMonthLabel } from "../../../lib/power/wash-months";
import { isDemoMode } from "../../shell/layout-data";
import { kwh, money, secondsLabel, temperatureLabel, watts } from "../bill-format";
import { LaundryPrint, WashWhoSelect } from "../laundry-client";
import { WashGraph } from "../wash-graph";

// One wash's own sheet: everything the bill's row cannot hold — the run's own
// figures, the plan it was costed at, who it belongs to, and the watts it drew at
// every sample the meter kept (specs/power-meters.md §5.3).
//
// The same document as the bill, one wash deep: the reader arrives here by
// tapping a row on their phone, so it wears the same paper, the same rules and
// the same `only light` opt-out, and it prints as a sheet of its own. Still a
// server component with no data endpoint: the store is read where it lives and
// the trace file's samples are read with it.
//
// The demo is left out of that read for the same reason the bill is: a static
// export has no server, and the build machine's data directory holds this
// household's real washes.

export const metadata: Metadata = {
  description: "One wash's own power: its energy, its cost, and the watts it drew.",
  title: "Wash — power used by one run",
};

/** The bill's own opt-out, because this is the same paper (§5.3). */
export const viewport: Viewport = { colorScheme: "only light" };

/**
 * The static demo build has no server, so every dynamic route needs the paths its
 * export can carry: the demo gets one, and shows this sheet's own empty state on
 * it, the way the bill shows its empty state there.
 */
export function generateStaticParams() {
  return isDemoMode ? [{ id: "demo" }] : [];
}

export default async function LaundryWashPage({ params }: { params: Promise<{ id: string }> }) {
  // `await params` alone does not make this page dynamic: the route declares
  // `generateStaticParams`, so Next renders each id once and serves that render
  // from then on. The sheet then kept showing the owner from the first visit and
  // `router.refresh()` after a pick returned the same cached render, so a wash
  // read as mis-attributed and could not be changed from here. The bill stays
  // dynamic through `searchParams`; this sheet has none, so it opts in. The demo
  // export has no server to render on.
  if (!isDemoMode) await connection();
  const { id } = isDemoMode ? { id: "" } : await params;
  const wash = isDemoMode || !id ? null : await readWashDetail(id);
  if (!wash) {
    return (
      <main className="laundry-page">
        {/* Not an error page: this URL is one somebody may have typed by hand, or
            a link older than the 400 days the store keeps (§5.3). */}
        <p className="laundry-empty">
          That wash is not in the store any more — the bill lists the washes this dashboard holds.
          <br />
          <Link className="laundry-button" href="/laundry">
            Open the bill
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="laundry-page">
      <div className="laundry-bar">
        <nav className="laundry-nav" aria-label="Month">
          <Link className="laundry-button" href={`/laundry?month=${wash.monthKey}`} rel="up">
            ← {washMonthLabel(wash.monthKey)}
          </Link>
        </nav>
        <LaundryPrint />
      </div>

      <section className="laundry-sheet">
        <header className="laundry-bill-head">
          <div className="laundry-bill-id">
            <h1 className="laundry-doc-title">Power used by one wash</h1>
            <p className="laundry-period">
              {wash.dateLabel} · {wash.startLabel} to {wash.endLabel}
              {wash.running ? " · running" : ""}
            </p>
            <p className="laundry-plan">
              {wash.rate.planName} — {wash.rate.cPerKwh.toFixed(3)}c/kWh
              {wash.rate.includingGst ? " incl. GST" : ""}, the plan this wash was costed at.
            </p>
          </div>
          <dl className="laundry-figures">
            <div>
              <dt>Length</dt>
              <dd>{wash.durationLabel}</dd>
            </div>
            <div>
              <dt>Temperature</dt>
              <dd>{temperatureLabel(wash.temperature)}</dd>
            </div>
            <div>
              <dt>Energy</dt>
              <dd>{kwh(wash.kwh)}</dd>
            </div>
            <div className="is-emphasis">
              <dt>Cost</dt>
              <dd>{money(wash.costNzd)}</dd>
            </div>
            {wash.cPerKwh === null ? null : (
              <div>
                <dt>Unit cost</dt>
                <dd>{wash.cPerKwh.toFixed(2)}c/kWh</dd>
              </div>
            )}
            <div>
              <dt>Peak</dt>
              <dd>{watts(wash.peakWatts)}</dd>
            </div>
            <div>
              <dt>Average</dt>
              <dd>{watts(wash.averageWatts)}</dd>
            </div>
          </dl>
        </header>

        <section className="laundry-block">
          <h2 className="laundry-caption">Power drawn</h2>
          <WashGraph
            averageWatts={wash.averageWatts}
            durationLabel={wash.durationLabel}
            durationSeconds={wash.durationSeconds}
            endLabel={wash.endLabel}
            peakAtSeconds={wash.peakAtSeconds}
            peakWatts={wash.peakWatts}
            samples={wash.points}
            startLabel={wash.startLabel}
          />
        </section>

        {/* What the temperature above rests on: the element's own run, which is the
            only thing in a trace that records the button somebody pressed (§5.3). */}
        {wash.temperature.source === "degrees" ? (
          <p className="laundry-note">
            The element ran {secondsLabel(wash.temperature.heatUp.seconds)} at{" "}
            {watts(wash.temperature.heatUp.watts)}: the water coming up to{" "}
            {wash.temperature.degrees}°C.
          </p>
        ) : null}

        <section className="laundry-block">
          <h2 className="laundry-caption">Claimed by</h2>
          <p className="laundry-detail-claim">
            <WashWhoSelect
              active={wash.running}
              cycleId={wash.id}
              people={wash.people}
              person={wash.person}
            />
          </p>
        </section>

        <p className="laundry-note">
          A wash costs what the machine's own plan charges for the power it used, at the rate in force
          while it ran.
          {wash.running
            ? " This one is still running: its figures so far are shown, and it belongs to nobody until it closes."
            : ""}
        </p>
      </section>
    </main>
  );
}
