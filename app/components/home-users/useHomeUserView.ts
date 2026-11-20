"use client";

import { useMemo } from "react";
import type { DashboardState } from "../../../lib/types";
import { buildZoneTree } from "../dashboard/ZonesPanel";
import { HOUSEHOLD_VIEW, useHomeUser } from "./homeUserSetting";
import { emptyRoomsNotice, quickAccessDataFor, viewForHomeUser } from "./view-model";

/** The dashboard as this device's home user sees it (specs/home-users.md). */
export function useHomeUserView(data: DashboardState | null) {
  const id = useHomeUser();
  const person = useMemo(
    () => (id && id !== HOUSEHOLD_VIEW ? (data?.homeUsers?.find((user) => user.id === id) ?? null) : null),
    [data?.homeUsers, id],
  );
  const zoneTree = useMemo(() => viewForHomeUser(buildZoneTree(data), person), [data, person]);
  const quickData = useMemo(() => quickAccessDataFor(data, person), [data, person]);
  return { person, zoneTree, quickData, emptyNotice: emptyRoomsNotice(zoneTree, person) };
}
