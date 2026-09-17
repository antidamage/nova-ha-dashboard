/**
 * Dashboard config — facade. The body lives in lib/dashboard-config/; this file
 * keeps the import path stable for its ~35 callers
 * (specs/agent-token-footprint.md §3.3).
 *
 *   dashboard-config/constants.ts      the file paths, incl. the env-derived ones
 *   dashboard-config/env-model.ts      environment compatibility overrides
 *   dashboard-config/schema-model.ts   validation and the published JSON schema
 *   dashboard-config/store.ts          SOLE file owner: the layer merge, reads,
 *                                      the runtime store and the atomic write
 *   dashboard-config/secret-status.ts  setup status for optional credentials
 *
 * The merge order and the household overlay's place in it are documented at the
 * top of `store.ts`, and in specs/configuration-model.md.
 */
export { parseMapCenter } from "./dashboard-config/env-model";
export { validateDashboardConfig, dashboardConfigJsonSchema } from "./dashboard-config/schema-model";
export {
  readDefaultDashboardConfig,
  readStoredDashboardConfig,
  readHouseholdDashboardConfig,
  readDashboardConfig,
  readDashboardConfigSync,
  writeDashboardConfig,
  patchDashboardConfig,
  dryRunDashboardConfigImport,
  redactDashboardConfig,
  exportDashboardConfig,
} from "./dashboard-config/store";
export { readSecretSetupStatus } from "./dashboard-config/secret-status";
