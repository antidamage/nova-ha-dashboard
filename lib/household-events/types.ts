import type { HaState } from "../types";
import type { HOUSEHOLD_EVENT_KINDS } from "./constants";

export type HouseholdEventKind = (typeof HOUSEHOLD_EVENT_KINDS)[number];
export type HouseholdEventSource =
  | "home_assistant"
  | "dashboard"
  | "calendar"
  | "reminder"
  | "agent_task";

export type HouseholdEvent = {
  version: 1;
  cursor: number;
  id: string;
  occurredAt: string;
  source: HouseholdEventSource;
  kind: HouseholdEventKind;
  deduplicationKey: string;
  payload: Record<string, unknown>;
};

export type HouseholdEventInput = Omit<HouseholdEvent, "cursor" | "id" | "version">;

export type HouseholdEventBatch = {
  version: 1;
  after: number;
  firstAvailableCursor: number;
  nextCursor: number;
  resetRequired: boolean;
  events: HouseholdEvent[];
};

export type HaStateChange = {
  contextId?: string;
  entityId: string;
  oldState?: HaState | null;
  newState?: HaState | null;
};
