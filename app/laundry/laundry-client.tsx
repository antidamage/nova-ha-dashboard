"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { HouseholdPerson } from "../../lib/config-schema";

/**
 * Who a wash belongs to, as a plain `<select>` — the laundry page's one control
 * (specs/power-meters.md §5.3).
 *
 * **Deliberately not the dashboard's picker.** `ConfigSelect` is a themed,
 * portalled listbox: it carries the app's palette, cuts its corners with a
 * clip-path and opens a menu on `document.body`, which on a printed bill is the
 * dashboard sitting on top of the document. A bill gets a plain form field, and
 * this file imports no dashboard component at all.
 *
 * A name is sent, never a step, so a mis-pick is corrected by picking again, and
 * the control **never guesses**: the name shown is the one the page was rendered
 * with, and a pick appears when the refreshed render arrives carrying it — never
 * before. An optimistic value was tried twice and withdrawn twice: dropped when
 * the response landed it flicked back to the owner from before the write, and
 * held until the read agreed it could never clear when the store's answer came
 * back different (another screen naming the same wash), so the row showed
 * somebody the store did not hold while the totals on the same page —
 * server-rendered from that same store — said otherwise.
 *
 * The control is disabled from the pick until the render that carries the
 * answer, so there is no window in which the row shows the pre-write owner with
 * nothing to say a write is coming.
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
  const [refreshing, startRefresh] = useTransition();
  // A person this household no longer configures — somebody removed from the
  // config page, or renamed there — counts as Unassigned, which is what the
  // totals already do with such a wash (`monthTotals`). Showing the first
  // configured person instead would read as a claim nobody made.
  const known = person !== null && people.some((candidate) => candidate.id === person) ? person : null;
  /** The write, and the render that answers it. The control is disabled across both. */
  const busy = saving || refreshing;

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
      {/* Screen: the field. Paper: the name on its own, so the printed bill has
          no control on it and still says whose wash it was. */}
      <select
        aria-label="Who ran this wash"
        className="laundry-who-select"
        disabled={busy}
        onChange={(event) => void write(event.target.value)}
        value={known ?? ""}
      >
        {people.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.label}
          </option>
        ))}
        <option value="">Unassigned</option>
      </select>
      <span className="laundry-who-printed">
        {people.find((candidate) => candidate.id === known)?.label ?? "Unassigned"}
      </span>
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
