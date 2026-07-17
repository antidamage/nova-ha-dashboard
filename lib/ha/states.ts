import type { HaState } from "../types";

export function stateById(states: HaState[], entityId: string): HaState | undefined {
  return states.find((state) => state.entity_id === entityId);
}
