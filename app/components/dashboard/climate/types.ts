import type { EntityActionInput } from "../../../../lib/aircon-control";

export type EntityActionsHandler = (
  actions: EntityActionInput[],
  toast: string,
  options?: { silent?: boolean },
) => Promise<void>;
