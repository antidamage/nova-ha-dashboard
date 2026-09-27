"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { HouseholdPerson } from "../../lib/config-schema";
import { ConfigSelect } from "../components/ConfigSelect";

/**
 * Who a wash belongs to, as a picker — the laundry page's one control
 * (specs/power-meters.md §5.3).
 *
 * A picker rather than the panel's cycling tap, because the two surfaces are
 * read differently: the panel is glanced at and tapped when a wash is running,
 * while this page is read afterwards and the reader already knows whose it was.
 * Both write the same store through the same route, so the panel and this page
 * can never disagree.
 *
 * A name is sent, never a step, so a mis-pick is corrected by picking again.
 *
 * **It does not guess.** The name on screen is always the one the page was
 * rendered with, and a pick is shown when the refreshed server render arrives
 * carrying it — never before. An optimistic value was tried twice and withdrawn
 * twice: dropped when the response landed it flicked back to the owner from
 * before the write, and held until the read agreed it could never clear when the
 * store's answer came back different (another screen naming the same wash), so
 * the row showed somebody the store did not hold while the totals on the same
 * page — server-rendered from that same store — said otherwise. A control that
 * displays an unconfirmed claim is worse than one that shows it is working.
 *
 * The control is disabled, and says `Saving…`, from the pick until the render
 * that carries the answer — the write's own round trip *and* the refresh's — so
 * there is no window in which the row shows the pre-write owner with an enabled
 * control and nothing to say a write is coming.
 */
export function WashWhoSelect({
  active = false,
  cycleId,
  people,
  person,
}: {
  /** The wash under way rather than a stored one. */
  active?: boolean;
  cycleId: string;
  people: HouseholdPerson[];
  person: string | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // The refreshed render is a second wait after the write's, and the control is
  // disabled across both: "in flight" ends when the row shows the pick, not when
  // the HTTP response lands. Ending it at the response left a window where the
  // row showed the owner from before the write with an enabled control and
  // nothing to say it was working — and a pick that re-asserted the name still on
  // screen was dropped by the same-value guard below, silently.
  const [refreshing, startRefresh] = useTransition();
  // A person this household no longer configures — somebody removed from the
  // config page, or renamed there — counts as Unassigned, which is what the
  // totals already do with such a wash (`monthTotals`). Showing the first
  // configured person instead would read as a claim nobody made.
  const known = person !== null && people.some((candidate) => candidate.id === person) ? person : null;
  /** The write, and the render that answers it. The control is disabled across both. */
  const busy = saving || refreshing;
  const options = [
    ...people.map((candidate) => ({
      label: candidate.label,
      swatch: <span className="laundry-swatch" style={{ background: candidate.color }} aria-hidden="true" />,
      value: candidate.id,
    })),
    { label: "Unassigned", swatch: <span className="laundry-swatch is-empty" aria-hidden="true" />, value: "" },
  ];

  const write = async (value: string) => {
    const next = value === "" ? null : value;
    if (next === known || busy) return;
    setSaving(true);
    setFailed(false);
    try {
      const response = await fetch("/api/power/washing-machine", {
        body: JSON.stringify({ ...(active ? { active: true } : {}), cycleId, person: next }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Wash claim failed");
      // The store holds the pick from here; the row shows it when this render
      // arrives with it. Nothing about the pick is drawn before that.
      startRefresh(() => router.refresh());
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="laundry-who">
      {/* Screen: the picker. Paper: the name on its own, so the printed bill has
          no control on it and still says whose wash it was. */}
      <span className="laundry-who-select">
        <ConfigSelect
          ariaLabel="Who ran this wash"
          disabled={busy}
          onChange={(value) => void write(value)}
          options={options}
          value={known ?? ""}
        />
      </span>
      <span className="laundry-who-printed">
        {people.find((candidate) => candidate.id === known)?.label ?? "Unassigned"}
      </span>
      {/* The write is in flight, or the answer is still coming, or it was
          refused. Both are the only things this control ever says about itself. */}
      {busy ? <span className="laundry-who-busy">Saving…</span> : null}
      {failed ? <span className="laundry-who-failed" role="alert">Not saved</span> : null}
    </span>
  );
}

/** The page's print affordance. Printing itself needs no server round trip. */
export function LaundryPrint() {
  return (
    <button className="laundry-button" onClick={() => window.print()} type="button">
      Print
    </button>
  );
}
