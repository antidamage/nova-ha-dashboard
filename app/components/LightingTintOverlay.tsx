"use client";

/**
 * A flat layer in the room's light colour, blended over the whole page —
 * dashboard, config and every portalled modal. Input passes through it.
 * Enabled per theme (`lightingTint`); see specs/lighting-tint.md.
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { DashboardState } from "../../lib/types";
import { tintColor } from "./dashboard/lightingTint";
import { useLightingTintZone } from "./dashboard/lightingTintZoneSetting";
import { subscribeToDashboardEvents } from "./sharedDashboardEvents";

function tintEnabled() {
  return document.documentElement.dataset.lightingTint === "on";
}

function useTintEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(tintEnabled());
    const observer = new MutationObserver(() => setEnabled(tintEnabled()));
    observer.observe(document.documentElement, { attributeFilter: ["data-lighting-tint"] });
    return () => observer.disconnect();
  }, []);
  return enabled;
}

export function LightingTintOverlay() {
  const pathname = usePathname()?.replace(/\/$/, "");
  const enabled = useTintEnabled();
  const [zoneId] = useLightingTintZone();
  const [lit, setLit] = useState(false);
  // Kept after the lights go off so the layer fades out in the last colour.
  const [rgb, setRgb] = useState<[number, number, number]>([0, 0, 0]);

  useEffect(() => {
    if (!enabled) {
      setLit(false);
      return;
    }
    let cancelled = false;
    const apply = (state: DashboardState | null) => {
      if (cancelled) return;
      const next = tintColor(state, zoneId);
      setLit(Boolean(next));
      if (next) setRgb((current) => (current.every((part, i) => part === next[i]) ? current : next));
    };

    fetch("/api/state", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<DashboardState>) : null))
      .then(apply)
      .catch(() => {});
    const unsubscribe = subscribeToDashboardEvents({
      state: (event) => {
        try {
          apply(JSON.parse(event.data) as DashboardState);
        } catch {
          // A malformed push leaves the last colour in place.
        }
      },
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled, zoneId]);

  // The bill is a document on white paper: the room's light colour blended over
  // it is dashboard chrome on somebody else's printout (specs/power-meters.md
  // §5.3). The layer is skipped there rather than rendered transparent, so a
  // tint can never paint on the sheet.
  if (pathname === "/laundry" || pathname?.startsWith("/laundry/")) return null;

  return (
    <div
      aria-hidden="true"
      className="lighting-tint-overlay"
      data-lit={lit ? "true" : "false"}
      style={{ backgroundColor: `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})` }}
    />
  );
}
