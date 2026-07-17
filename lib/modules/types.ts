import type { DashboardConfig } from "../config-schema";
import type { DashboardEntity, DashboardState, HaHealth, HaState } from "../types";
import type { RegistryIndex, RegistrySnapshot } from "../ha/registry";

/**
 * Everything a dashboard module needs to derive its contribution from the live
 * Home Assistant snapshot. `entities` is the projected set (already classified +
 * zoned-ready); `warnings` is mutable so a module can surface a problem.
 */
export type ModuleStateContext = {
  config: DashboardConfig;
  states: HaState[];
  registry: RegistrySnapshot;
  index: RegistryIndex;
  entities: DashboardEntity[];
  warnings: string[];
  /** Freshness verdict for the HA snapshot these states came from. */
  haHealth?: HaHealth;
};

export type ModuleRequirement = {
  /** Whether this requirement is currently satisfied by the HA setup. */
  ok: boolean;
  label: string;
  detail?: string;
};

export type ModuleStatus = {
  id: string;
  title: string;
  /** True when the module has everything it needs to function in this home. */
  active: boolean;
  summary?: string;
  requirements: ModuleRequirement[];
};

/**
 * A dashboard module owns one capability end-to-end: its detection from HA, its
 * contribution to dashboard state, and (via separate client/MCP registries) its
 * panel and agent tools. Keeping these together is what makes adding a feature a
 * single-folder change instead of edits scattered across the codebase.
 */
export type DashboardModule = {
  id: string;
  title: string;
  description: string;
  /**
   * Mutate the projected entities before zones are assembled — e.g. overriding a
   * climate entity's reported temperature with a trusted room sensor. Runs for
   * every module in registry order.
   */
  transformEntities?: (context: ModuleStateContext) => void;
  /**
   * Report whether the module is satisfied by the current HA setup and what it
   * still needs. Powers the MCP `nova.modules.status` agent-deploy checklist.
   */
  status?: (context: ModuleStateContext) => ModuleStatus;
};
