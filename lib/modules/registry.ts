import type { DashboardModule, ModuleStateContext, ModuleStatus } from "./types";
import { routerModule } from "./router/module";
import { weatherModule } from "./weather/module";
import { climateModule } from "./climate/module";

/**
 * The installed dashboard modules. Adding a capability means adding a module
 * here (and, for UI, a panel in the client panel registry) — not editing the
 * state builder, the MCP server, and the panel dispatch separately.
 */
export const dashboardModules: DashboardModule[] = [routerModule, weatherModule, climateModule];

export function applyEntityTransforms(context: ModuleStateContext): void {
  for (const module of dashboardModules) {
    module.transformEntities?.(context);
  }
}

export function moduleStatuses(context: ModuleStateContext): ModuleStatus[] {
  return dashboardModules
    .map((module) => module.status?.(context))
    .filter((status): status is ModuleStatus => Boolean(status));
}
