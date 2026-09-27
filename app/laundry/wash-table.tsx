import Link from "next/link";
import type { HouseholdPerson } from "../../lib/config-schema";
import type { WashMonthCycle } from "../../lib/power";
import { washClaimColor } from "../../lib/power/wash-months";
import { kwh, money, temperatureLabel } from "./bill-format";
import { WashRow } from "./laundry-row";
import { WashWhoSelect } from "./laundry-client";

/**
 * The month's washes, one ruled row each (specs/power-meters.md §5.3).
 *
 * A sibling of the page rather than part of it: the bill's own file sits against
 * the repo's 10 KB cap (specs/agent-token-footprint.md §2), so the table lives
 * here and the page renders it. The move changes no behaviour of the bill — the
 * same rows, the same classes, the same link, the same claim field.
 *
 * Each row wears the colour of the person who claimed it, and opens that wash's
 * own sheet; the claim field in the last cell keeps its own gestures (§5.3).
 */
export function WashTable({
  people,
  rows,
  running,
}: {
  people: HouseholdPerson[];
  /** The month's washes, with the one under way at their head. */
  rows: WashMonthCycle[];
  /** The wash under way, whose row marks itself and claims through the open route. */
  running: WashMonthCycle | null;
}) {
  return (
    <table className="laundry-table">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Start</th>
          <th scope="col">Length</th>
          <th scope="col">Temp</th>
          <th scope="col" className="is-number">Energy</th>
          <th scope="col" className="is-number">Cost</th>
          <th scope="col">Claimed by</th>
        </tr>
      </thead>
      <tbody>
        {/* Whose wash it is: the panel's colour for that person (§5.2). */}
        {rows.map((cycle) => (
          <WashRow
            className={cycle === running ? "laundry-row is-running" : "laundry-row"}
            href={`/laundry/${cycle.id}`}
            key={cycle.id}
            style={{ background: washClaimColor(cycle.person, people) }}
          >
            <td>
              <Link className="laundry-row-link" href={`/laundry/${cycle.id}`}>
                {cycle.dateLabel}
              </Link>
            </td>
            <td>{cycle.startLabel}</td>
            <td>{cycle.durationLabel}{cycle === running ? " — running" : ""}</td>
            <td>{temperatureLabel(cycle.temperature)}</td>
            <td className="is-number">{kwh(cycle.kwh)}</td>
            <td className="is-number">{money(cycle.costNzd)}</td>
            <td>
              <WashWhoSelect active={cycle === running} cycleId={cycle.id} people={people} person={cycle.person} />
            </td>
          </WashRow>
        ))}
        {rows.length === 0 ? (
          <tr className="laundry-row is-empty">
            <td colSpan={7}>No washes this month.</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}
