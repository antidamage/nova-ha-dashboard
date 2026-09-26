"use client";

import { useCallback, useEffect, useState } from "react";
import type { HouseholdPerson } from "../../../../lib/config-schema";
import type { ArrivalPresets, ArrivalTargetOption } from "./arrival-config-model";

/** The same kill-switch the lighting rules client uses: the demo has no server. */
const DEMO_MODE = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";
const DEMO_KEY = "nova.dashboard.demoArrivals.v1";
const NEW_PERSON_LABEL = "New person";

export type ArrivalSettingsPayload = {
  members: HouseholdPerson[];
  targets: ArrivalTargetOption[];
  presets: ArrivalPresets;
};

const EMPTY: ArrivalSettingsPayload = { members: [], targets: [], presets: {} };

/** The target kinds and their labels, as the server names them. */
const ARRIVAL_TARGETS_FALLBACK: ArrivalTargetOption[] = [
  { kind: "lighting", label: "Lighting" },
  { kind: "climate", label: "Air conditioning" },
  { kind: "volume", label: "Volume" },
];

export { NEW_PERSON_LABEL };

function readDemo(): ArrivalSettingsPayload {
  try {
    const raw = window.sessionStorage.getItem(DEMO_KEY);
    const parsed = raw ? (JSON.parse(raw) as { members?: HouseholdPerson[] }) : null;
    // The demo starts with no members on purpose: `dashboard.people` ships empty
    // rather than inventing people, and this section does not change that.
    if (parsed?.members) {
      return { targets: ARRIVAL_TARGETS_FALLBACK, presets: {}, members: parsed.members };
    }
  } catch {
    // An unreadable demo store starts empty.
  }
  return { ...EMPTY, targets: ARRIVAL_TARGETS_FALLBACK };
}

/**
 * The section's data: the household people, the target kinds and each target's
 * current presets, plus the one write (the whole people array).
 *
 * In demo mode it never fetches — a route added to `app/api` is not served by the
 * demo build (`lib/demo-config/bootstrap-script.ts`) — and keeps to a
 * sessionStorage store, where adding a member still works.
 */
export function useArrivalSettings() {
  const [data, setData] = useState<ArrivalSettingsPayload>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (DEMO_MODE) {
      setData(readDemo());
      setLoading(false);
      return;
    }
    try {
      const response = await fetch("/api/arrivals", { cache: "no-store" });
      if (!response.ok) throw new Error(`Arrival settings unavailable: ${response.status}`);
      setData((await response.json()) as ArrivalSettingsPayload);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Arrival settings are unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (members: HouseholdPerson[]) => {
    if (DEMO_MODE) {
      window.sessionStorage.setItem(DEMO_KEY, JSON.stringify({ members }));
      setData((current) => ({ ...current, members }));
      return true;
    }
    try {
      const response = await fetch("/api/arrivals", {
        body: JSON.stringify({ people: members }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const body = (await response.json()) as ArrivalSettingsPayload & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Saving failed: ${response.status}`);
      setData(body);
      setError(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saving the arrival settings failed");
      return false;
    }
  }, []);

  return { data, error, loading, save };
}
