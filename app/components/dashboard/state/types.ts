import type { DashboardState } from "../../../../lib/types";

export type LoadState = "idle" | "loading" | "error";

export type ApplyEntityActionsOptions = {
  // Retained for call-site compatibility. Interaction feedback now comes from
  // the originating button or slider, so delayed/background commands are
  // naturally silent.
  silent?: boolean;
};

export type RefreshDashboardState = (options?: { force?: boolean }) => Promise<DashboardState | null>;
