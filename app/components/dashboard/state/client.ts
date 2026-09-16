"use client";

import type { DashboardState } from "../../../../lib/types";
import { SNAPSHOT_FETCH_TIMEOUT_MS } from "./constants";

export async function fetchDashboardStateSnapshot() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SNAPSHOT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch("/api/state", { cache: "no-store", signal: controller.signal });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load dashboard state");
    }
    return payload as DashboardState;
  } finally {
    clearTimeout(timeout);
  }
}
