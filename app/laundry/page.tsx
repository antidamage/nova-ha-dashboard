import Link from "next/link";
import { readWashMonth } from "../../lib/power";
import { isDemoMode } from "../shell/layout-data";
import { LaundryPrint, WashWhoSelect } from "./laundry-client";

// The washing machine's own power history, page by month, for the household to
// read and to claim a wash from — a standalone page rather than a dashboard
// panel, because the reader is not the dashboard: it is somebody with a phone
// who wants the month's washes and whose they were (specs/power-meters.md §5.3).
//
// Deliberately a server component with no data endpoint of its own: the store is
// read where it lives, the page prints from a plain document, and the only
// interactive part is the claim picker. Nothing here can change anything except
// who a wash belongs to.
//
// The demo is left out of that read on purpose. It is a static export with no
// server, so the page must be renderable at build time — and the build machine
// has a real data directory, so reading the store there would publish this
// household's washes to a public host. The demo shows the page's own empty
// state, the same way the panel's card is absent when no meter is configured.
// Awaiting `searchParams` is what keeps the page dynamic everywhere else, rather
// than a `force-dynamic` the export build cannot render at all.

const MONTH_KEY = /^\d{4}-\d{2}$/;

/** Energy, to the precision a wash is worth: a spin is a few hundredths. */
function kwh(value: number) {
  return `${value < 1 ? value.toFixed(3) : value.toFixed(2)} kWh`;
}

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

export default async function LaundryPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month } = isDemoMode ? { month: undefined } : await searchParams;
  const view = isDemoMode
    ? null
    : await readWashMonth(typeof month === "string" && MONTH_KEY.test(month) ? month : null);
  if (!view) {
    return (
      <main className="laundry-page">
        <p className="laundry-empty">No washing machine is configured on this dashboard.</p>
      </main>
    );
  }

  const average = view.kwh > 0 ? (view.costNzd / view.kwh) * 100 : 0;

  return (
    <main className="laundry-page">
      <header className="laundry-head">
        <div>
          <h1>Laundry</h1>
          <p className="laundry-sub">Power used by the washing machine</p>
        </div>
        <LaundryPrint />
      </header>

      <nav className="laundry-nav" aria-label="Month">
        {view.previousMonthKey ? (
          <Link className="laundry-button" href={`/laundry?month=${view.previousMonthKey}`} rel="prev">
            ← Previous month
          </Link>
        ) : <span className="laundry-button is-disabled">← Previous month</span>}
        <span className="laundry-month">{view.label}</span>
        {view.nextMonthKey ? (
          <Link className="laundry-button" href={`/laundry?month=${view.nextMonthKey}`} rel="next">
            Next month →
          </Link>
        ) : <span className="laundry-button is-disabled">Next month →</span>}
      </nav>

      <section className="laundry-sheet">
        <div className="laundry-sheet-head">
          <div>
            <p className="laundry-period">{view.label}</p>
            <p className="laundry-plan">{view.rate.planName}</p>
          </div>
          <p className="laundry-rate">
            {view.rate.cPerKwh.toFixed(3)}c/kWh{view.rate.includingGst ? " including GST" : ""}
            {view.rate.asOf ? <span className="laundry-asof">at {view.rate.asOf}</span> : null}
          </p>
        </div>

        {view.rate.windows.length > 0 ? (
          <ul className="laundry-windows">
            {view.rate.windows.map((window) => (
              <li key={window.label}>
                {window.label} — {window.cPerKwh.toFixed(3)}c/kWh
              </li>
            ))}
          </ul>
        ) : null}

        <table className="laundry-table">
          <caption className="laundry-caption">Washes</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Start</th>
              <th scope="col">Length</th>
              <th scope="col" className="is-number">Energy</th>
              <th scope="col" className="is-number">Cost</th>
              <th scope="col">Claimed by</th>
            </tr>
          </thead>
          <tbody>
            {view.running ? (
              <tr className="laundry-row is-running">
                <td>{view.running.dateLabel}</td>
                <td>{view.running.startLabel}</td>
                <td>{view.running.durationLabel} — running</td>
                <td className="is-number">{kwh(view.running.kwh)}</td>
                <td className="is-number">{money(view.running.costNzd)}</td>
                <td>
                  <WashWhoSelect active cycleId={view.running.id} people={view.people} person={view.running.person} />
                </td>
              </tr>
            ) : null}
            {view.cycles.map((cycle) => (
              <tr className="laundry-row" key={cycle.id}>
                <td>{cycle.dateLabel}</td>
                <td>{cycle.startLabel}</td>
                <td>{cycle.durationLabel}</td>
                <td className="is-number">{kwh(cycle.kwh)}</td>
                <td className="is-number">{money(cycle.costNzd)}</td>
                <td>
                  <WashWhoSelect cycleId={cycle.id} people={view.people} person={cycle.person} />
                </td>
              </tr>
            ))}
            {view.cycles.length === 0 && !view.running ? (
              <tr className="laundry-row is-empty">
                <td colSpan={6}>No washes this month.</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div className="laundry-totals">
          <table>
            <caption className="laundry-caption">Totals</caption>
            <thead>
              <tr>
                <th scope="col">Who</th>
                <th scope="col" className="is-number">Washes</th>
                <th scope="col" className="is-number">Energy</th>
                <th scope="col" className="is-number">Cost</th>
              </tr>
            </thead>
            <tbody>
              {view.totals.map((row) => {
                const who = view.people.find((person) => person.id === row.person);
                return (
                  <tr className={row.person === null ? "is-unassigned" : ""} key={row.person ?? "unassigned"}>
                    <td>{who?.label ?? "Unassigned"}</td>
                    <td className="is-number">{row.cycles}</td>
                    <td className="is-number">{kwh(row.kwh)}</td>
                    <td className="is-number">{money(row.costNzd)}</td>
                  </tr>
                );
              })}
              <tr className="is-total">
                <td>All washes</td>
                <td className="is-number">{view.washes}</td>
                <td className="is-number">{kwh(view.kwh)}</td>
                <td className="is-number">{money(view.costNzd)}</td>
              </tr>
              {average > 0 ? (
                <tr className="is-average">
                  <td>Average unit cost</td>
                  <td className="is-number" />
                  <td className="is-number" />
                  <td className="is-number">{average.toFixed(2)}c/kWh</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="laundry-note">
          A wash costs what the machine's own plan charges for the power it used, at the rate in force
          while it ran. The wash under way is listed but not counted until it finishes, and it belongs to
          nobody until somebody claims it.
        </p>
      </section>
    </main>
  );
}
