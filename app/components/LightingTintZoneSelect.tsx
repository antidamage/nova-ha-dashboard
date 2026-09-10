"use client";

import { useEffect, useState } from "react";
import type { DashboardState } from "../../lib/types";
import { ConfigSelect, type ConfigSelectOption } from "./ConfigSelect";
import { WHOLE_HOUSE_ZONE_ID } from "./dashboard/lightingTint";
import { useLightingTintZone } from "./dashboard/lightingTintZoneSetting";

const WHOLE_HOUSE_OPTION: ConfigSelectOption = { value: WHOLE_HOUSE_ZONE_ID, label: "Whole house (average)" };

/** This device's choice of which zone's lights the lighting tint follows. */
export function LightingTintZoneSelect() {
  const [zoneId, setZoneId] = useLightingTintZone();
  const [options, setOptions] = useState<ConfigSelectOption[]>([WHOLE_HOUSE_OPTION]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/state", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<DashboardState>) : null))
      .then((state) => {
        if (cancelled || !state) return;
        const rooms = state.zones
          .filter((zone) => !zone.special && zone.id !== WHOLE_HOUSE_ZONE_ID && zone.entities.some((entity) => entity.domain === "light"))
          .map((zone) => ({ value: zone.id, label: zone.name }));
        setOptions([WHOLE_HOUSE_OPTION, ...rooms]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // A stored zone that has since gone still shows, so the choice is visible.
  const shown = options.some((option) => option.value === zoneId) ? options : [...options, { value: zoneId, label: zoneId }];

  return <ConfigSelect label="Lighting Tint Follows" ariaLabel="Lighting tint follows" value={zoneId} options={shown} onChange={setZoneId} />;
}
